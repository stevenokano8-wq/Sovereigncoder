import express from "express";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

import { initDb, getMessages, addMessage, clearMessages, getTasks, deleteTasks, deleteTaskById, getFiles, clearFiles, saveFile, deleteFileOrFolder, renameFileOrFolder } from "./server/db.js";
import { initRedis, redisFlush } from "./server/redis.js";
import { planBuildTasks, executeAgentBuild, sseClients, broadcastSSE, registerPendingApproval, getPendingApproval, clearPendingApproval, buildSimpleFallbackTasks } from "./server/agent.js";
import { getGithubConfig, cloneRepository, repoNameFromUrl } from "./server/github.js";
import { DatabaseStatus, Message, Task } from "./src/types.js";

const app = express();
const PORT = 3000;

app.use(express.json());

// Server-side state of our DBs
let dbStatus: DatabaseStatus = {
  postgres: "local_fallback",
  redis: "local_fallback"
};

// API: Database and cache statuses
app.get("/api/db-status", (req, res) => {
  res.json({
    postgres: dbStatus.postgres,
    redis: dbStatus.redis,
    postgresUrl: dbStatus.postgresUrl ? maskConnectionString(dbStatus.postgresUrl) : undefined,
    redisUrl: dbStatus.redisUrl ? maskConnectionString(dbStatus.redisUrl) : undefined,
  });
});

// API: Get messages
app.get("/api/messages", async (req, res) => {
  try {
    const msgs = await getMessages();
    res.json(msgs);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// API: Add user message & trigger Sovereign Agent
app.post("/api/messages", async (req, res) => {
  try {
    const { role, content, useThinking, sessionId } = req.body;
    if (!content) {
      return res.status(400).json({ error: "Content is required" });
    }

    const userMsg: Message = {
      id: `msg-${Date.now()}-user`,
      role: role || "user",
      content,
      timestamp: new Date().toISOString(),
    };

    // Save user message to database
    await addMessage(userMsg);

    // If it's a user command, trigger the agent task planner and background executor
    if (userMsg.role === "user") {
      try {
        // Detect GitHub clone request
        const gitUrlMatch = content.match(/(https?:\/\/)?(www\.)?github\.com\/[a-zA-Z0-9_-]+\/[a-zA-Z0-9_.-]+(\.git)?/i);
        const isCloneReq = gitUrlMatch || content.toLowerCase().includes("clone ");

        if (isCloneReq) {
          const targetUrl = gitUrlMatch ? gitUrlMatch[0] : content.split(/\s+/).find((w: string) => w.startsWith("http") || w.includes("github.com"));
          if (targetUrl) {
            const repoUrl = targetUrl.startsWith("http") ? targetUrl : `https://${targetUrl}`;
            const taskId = `task-clone-${Date.now()}`;
            const repoName = repoNameFromUrl(repoUrl);
            
            const cloneTask: Task = {
              id: taskId,
              name: `Clone & Import Repository: ${repoName}`,
              status: "running",
              progress: 10,
              activeSubtaskIndex: 0,
              createdAt: new Date().toISOString(),
              complexity: "simple",
              requiresApproval: false,
              subtasks: [
                { id: `${taskId}-sub-0`, taskId, name: "Establish Git handshake and fetch remote pack", status: "running", logs: ["Connecting to remote host..."] },
                { id: `${taskId}-sub-1`, taskId, name: "Extract filesystem tree and index files", status: "pending", logs: ["Waiting..."] },
                { id: `${taskId}-sub-2`, taskId, name: "Load repository commit chronology and active branch", status: "pending", logs: ["Waiting..."] }
              ]
            };

            await saveTaskWithRetry(cloneTask);
            userMsg.taskId = taskId;
            broadcastSSE("build-started", { prompt: `Clone ${repoName}`, totalTasks: 1 });
            broadcastSSE("task-update", cloneTask);

            // Run clone in background
            (async () => {
              try {
                cloneTask.subtasks[0].logs.push(`[${new Date().toLocaleTimeString()}] Fetching repository pack files from ${repoUrl}...`);
                await saveTaskWithRetry(cloneTask);
                broadcastSSE("task-update", cloneTask);

                const result = await cloneRepository(repoUrl, sessionId);

                cloneTask.subtasks[0].status = "completed";
                cloneTask.subtasks[0].logs.push(`[${new Date().toLocaleTimeString()}] Successfully fetched and decrypted remote Pack files.`);
                cloneTask.progress = 40;
                
                cloneTask.activeSubtaskIndex = 1;
                cloneTask.subtasks[1].status = "running";
                cloneTask.subtasks[1].logs = [
                  `[Sovereign Agent] Extracting directory tree...`,
                  `[${new Date().toLocaleTimeString()}] Indexing and writing ${result.filesCount} modules into Workspace Storage...`
                ];
                await saveTaskWithRetry(cloneTask);
                broadcastSSE("task-update", cloneTask);
                await new Promise(r => setTimeout(r, 1200));

                cloneTask.subtasks[1].status = "completed";
                cloneTask.subtasks[1].logs.push(`[SUCCESS] Stored all cloned files in local workspace.`);
                cloneTask.progress = 80;

                cloneTask.activeSubtaskIndex = 2;
                cloneTask.subtasks[2].status = "running";
                cloneTask.subtasks[2].logs = [
                  `[Sovereign Agent] Reading commit graph...`,
                  `[${new Date().toLocaleTimeString()}] Loaded ${result.commits.length} commits on active branch "${result.branch}".`
                ];
                await saveTaskWithRetry(cloneTask);
                broadcastSSE("task-update", cloneTask);
                await new Promise(r => setTimeout(r, 800));

                cloneTask.subtasks[2].status = "completed";
                cloneTask.progress = 100;
                cloneTask.status = "completed";
                await saveTaskWithRetry(cloneTask);
                broadcastSSE("task-update", cloneTask);

                const assistantMsg: Message = {
                  id: `msg-clone-${Date.now()}-finish`,
                  role: "assistant",
                  content: `### Sovereign Git Sync Report\nI have successfully cloned and imported the repository **${result.repoName}**!\n\n- **Active Branch**: \`${result.branch}\`\n- **Imported Modules**: ${result.filesCount} code modules loaded into workspace.\n- **Commit Chronology**: Fetched the last ${result.commits.length} commits.\n\nAll imported repository files are now available in the **Code Tab** for you to inspect and modify!`,
                  timestamp: new Date().toISOString()
                };
                await addMessage(assistantMsg);
                broadcastSSE("build-finished", assistantMsg);
                broadcastSSE("connected", { status: "refreshed" });

              } catch (cloneErr: any) {
                console.error("Async background clone failed:", cloneErr);
                cloneTask.status = "failed";
                for (const sub of cloneTask.subtasks) {
                  if (sub.status === "running" || sub.status === "pending") {
                    sub.status = "failed";
                    sub.logs.push(`[ERROR] ${cloneErr.message || "Operation failed."}`);
                  }
                }
                await saveTaskWithRetry(cloneTask);
                broadcastSSE("task-update", cloneTask);

                const errAssistantMsg: Message = {
                  id: `msg-clone-err-${Date.now()}-finish`,
                  role: "assistant",
                  content: `### ⚠️ Git Clone Failed\nI encountered an error trying to clone and import the repository from **${repoUrl}**:\n\n\`\`\`\n${cloneErr.message}\n\`\`\`\n\nPlease make sure the repository is public and the URL is typed correctly.`,
                  timestamp: new Date().toISOString()
                };
                await addMessage(errAssistantMsg);
                broadcastSSE("build-finished", errAssistantMsg);
              }
            })();

            return res.json({ message: userMsg, tasks: [cloneTask] });
          }
        }

        // Step 1: Generate Tasks and Subtasks list with Gemini (with fallback)
        const plannedTasks = await planBuildTasks(content, useThinking);
        
        // Save initial tasks to SQL relational store
        for (const task of plannedTasks) {
          // Link first task to the message
          if (!userMsg.taskId) {
            userMsg.taskId = task.id;
          }
          await saveTaskWithRetry(task);
        }

        // If the plan needs the user's sign-off (e.g. a "simple" request that would have
        // pulled in backend/setup work), pause here instead of executing automatically.
        const needsApproval = plannedTasks.some(t => t.requiresApproval);
        if (needsApproval) {
          const buildId = plannedTasks.find(t => t.buildId)?.buildId || `build-${Date.now()}`;
          registerPendingApproval(buildId, content, plannedTasks, useThinking);
          broadcastSSE("plan-awaiting-approval", { buildId, tasks: plannedTasks });
        } else {
          // Trigger background asynchronous compilation/synthesis worker
          executeAgentBuild(content, plannedTasks, useThinking);
        }

        res.json({ message: userMsg, tasks: plannedTasks });
      } catch (agentErr: any) {
        console.error("Agent planning error:", agentErr);
        res.json({ message: userMsg, error: agentErr.message });
      }
    } else {
      res.json({ message: userMsg });
    }
  } catch (err: any) {
    console.error("API messages insert error:", err);
    res.status(500).json({ error: err.message });
  }
});

// API: Approve a plan that was paused awaiting user sign-off (e.g. extra backend/setup work)
app.post("/api/tasks/approve", async (req, res) => {
  try {
    const { buildId } = req.body;
    if (!buildId) {
      return res.status(400).json({ error: "buildId is required" });
    }

    const pending = getPendingApproval(buildId);
    if (!pending) {
      return res.status(404).json({ error: "No pending build found for that buildId" });
    }

    const approvedTasks = pending.tasks.map((t, idx) => ({
      ...t,
      status: idx === 0 ? ("pending" as const) : t.status,
      requiresApproval: false,
      approvalReason: undefined,
    }));

    for (const task of approvedTasks) {
      await saveTaskWithRetry(task);
    }

    clearPendingApproval(buildId);
    broadcastSSE("plan-approved", { buildId });

    executeAgentBuild(pending.prompt, approvedTasks, pending.useThinking);

    res.json({ status: "success", tasks: approvedTasks });
  } catch (err: any) {
    console.error("API tasks approve error:", err);
    res.status(500).json({ error: err.message });
  }
});

// API: Reject/cancel a plan that was paused awaiting user sign-off
app.post("/api/tasks/reject", async (req, res) => {
  try {
    const { buildId } = req.body;
    if (!buildId) {
      return res.status(400).json({ error: "buildId is required" });
    }

    const pending = getPendingApproval(buildId);
    if (!pending) {
      return res.status(404).json({ error: "No pending build found for that buildId" });
    }

    // "Keep It Simple": don't cancel the request outright — re-plan it as a bare,
    // no-backend task so the user's original intent is still fulfilled.
    // Remove the original pending task rows first so we don't end up with duplicates
    // alongside the freshly-generated simplified task.
    for (const task of pending.tasks) {
      await deleteTaskById(task.id);
    }

    const simplifiedTasks = buildSimpleFallbackTasks(pending.prompt).map((t, idx) => ({
      ...t,
      status: idx === 0 ? ("pending" as const) : t.status,
      complexity: "simple" as const,
      requiresApproval: false,
      approvalReason: undefined,
    }));

    for (const task of simplifiedTasks) {
      await saveTaskWithRetry(task);
    }

    clearPendingApproval(buildId);

    const systemMsg: Message = {
      id: `msg-${Date.now()}-system`,
      role: "system",
      content: "Kept it simple — proceeding without the extra backend/setup work.",
      timestamp: new Date().toISOString(),
    };
    await addMessage(systemMsg);

    broadcastSSE("plan-rejected", { buildId });

    executeAgentBuild(pending.prompt, simplifiedTasks);

    res.json({ status: "success", tasks: simplifiedTasks, message: systemMsg });
  } catch (err: any) {
    console.error("API tasks reject error:", err);
    res.status(500).json({ error: err.message });
  }
});

// Helper for saving task robustly
async function saveTaskWithRetry(task: any) {
  try {
    const { saveTask } = await import("./server/db.js");
    await saveTask(task);
  } catch (e) {
    console.error("Retry task save failed:", e);
  }
}

// API: Clear session history and variables
app.post("/api/session/clear", async (req, res) => {
  try {
    await clearMessages();
    await deleteTasks();
    await clearFiles();
    await redisFlush();
    broadcastSSE("session-cleared", {});
    res.json({ status: "success", message: "Conversation logs, task registry, files, and cache successfully purged." });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// API: Load a previously saved session state into the active database
app.post("/api/session/load", async (req, res) => {
  try {
    const { messages: newMsgs, tasks: newTasks, files: newFiles } = req.body;

    // 1. Flush active state
    await clearMessages();
    await deleteTasks();
    await clearFiles();
    await redisFlush();

    // 2. Load messages (skip welcome-msg as clearMessages creates one if welcome-msg doesn't exist, wait, clearMessages inserts a welcome-msg if count is 0. Let's do it safely)
    if (newMsgs && Array.isArray(newMsgs)) {
      // Clear welcome message if loading an actual chat session
      const actualMsgs = newMsgs.filter((m: any) => m.id !== "welcome-msg");
      if (actualMsgs.length > 0) {
        // We can just clear again without auto-seeding, or let the store add each msg
        for (const msg of actualMsgs) {
          await addMessage(msg);
        }
      } else {
        // Just keep the seeded welcome message
      }
    }

    // 3. Load tasks
    if (newTasks && Array.isArray(newTasks)) {
      for (const t of newTasks) {
        await saveTaskWithRetry(t);
      }
    }

    // 4. Load files
    if (newFiles && Array.isArray(newFiles)) {
      for (const f of newFiles) {
        await saveFile(f);
      }
    }

    // Broadcast SSE refresh notification so all clients update themselves
    broadcastSSE("connected", { status: "refreshed" });

    res.json({ status: "success", message: "Workspace session loaded successfully." });
  } catch (err: any) {
    console.error("API session load error:", err);
    res.status(500).json({ error: err.message });
  }
});

// API: Get tasks list
app.get("/api/tasks", async (req, res) => {
  try {
    const tasks = await getTasks();
    res.json(tasks);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// API: Get generated files
app.get("/api/files", async (req, res) => {
  try {
    const files = await getFiles();
    res.json(files);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// API: Save or update a file in the workspace database
app.post("/api/files/save", async (req, res) => {
  try {
    const { path: filePath, content, language } = req.body;
    if (!filePath) {
      return res.status(400).json({ error: "File path is required" });
    }
    await saveFile({ path: filePath, content: content || "", language: language || "typescript" });
    res.json({ status: "success" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// API: Delete a file or folder from the workspace database
app.post("/api/files/delete", async (req, res) => {
  try {
    const { path: filePath, isDirectory } = req.body;
    if (!filePath) {
      return res.status(400).json({ error: "File/Folder path is required" });
    }
    await deleteFileOrFolder(filePath, !!isDirectory);
    // Broadcast workspace refresh
    broadcastSSE("connected", { status: "refreshed" });
    res.json({ status: "success" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// API: Rename a file or folder in the workspace database
app.post("/api/files/rename", async (req, res) => {
  try {
    const { oldPath, newPath, isDirectory } = req.body;
    if (!oldPath || !newPath) {
      return res.status(400).json({ error: "oldPath and newPath are required" });
    }
    await renameFileOrFolder(oldPath, newPath, !!isDirectory);
    // Broadcast workspace refresh
    broadcastSSE("connected", { status: "refreshed" });
    res.json({ status: "success" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// API: Update settings & save to .env
app.post("/api/settings", async (req, res) => {
  try {
    const { geminiApiKey, postgresUrl, redisUrl } = req.body;

    const envPath = path.join(process.cwd(), ".env");
    let envContent = "";

    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, "utf8");
    }

    const updateEnvVar = (key: string, val: string) => {
      const regex = new RegExp(`^${key}=.*$`, "m");
      if (regex.test(envContent)) {
        envContent = envContent.replace(regex, `${key}="${val}"`);
      } else {
        envContent += `\n${key}="${val}"`;
      }
    };

    if (geminiApiKey) updateEnvVar("GEMINI_API_KEY", geminiApiKey);
    if (postgresUrl !== undefined) updateEnvVar("DATABASE_URL", postgresUrl);
    if (redisUrl !== undefined) updateEnvVar("REDIS_URL", redisUrl);

    fs.writeFileSync(envPath, envContent.trim() + "\n", "utf8");

    // Re-initialize env
    dotenv.config({ override: true });
    
    // Re-trigger DB/Redis initializations
    const pStatus = await initDb();
    const rStatus = await initRedis();

    dbStatus = {
      postgres: pStatus.postgres,
      redis: rStatus.status,
      postgresUrl: pStatus.postgresUrl,
      redisUrl: rStatus.url
    };

    res.json({
      status: "success",
      dbStatus: {
        postgres: dbStatus.postgres,
        redis: dbStatus.redis,
        postgresUrl: dbStatus.postgresUrl ? maskConnectionString(dbStatus.postgresUrl) : undefined,
        redisUrl: dbStatus.redisUrl ? maskConnectionString(dbStatus.redisUrl) : undefined,
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// API: Get connected GitHub configuration and commits
app.get("/api/github/config", (req, res) => {
  try {
    const sessionId = req.query.sessionId as string;
    const config = getGithubConfig(sessionId);
    res.json(config);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// API: Trigger GitHub cloning & indexing manually
app.post("/api/github/clone", async (req, res) => {
  try {
    const { repoUrl, sessionId } = req.body;
    if (!repoUrl) {
      return res.status(400).json({ error: "repoUrl is required" });
    }
    
    // Trigger clone
    const result = await cloneRepository(repoUrl, sessionId);
    
    // Broadcast workspace refresh
    broadcastSSE("connected", { status: "refreshed" });
    
    res.json(result);
  } catch (err: any) {
    console.error("API manual github clone error:", err);
    res.status(500).json({ error: err.message });
  }
});

// API: Real-time progress updates SSE connection
app.get("/api/tasks/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  sseClients.add(res);

  // Send initial connected ping with native retry interval
  res.write(`retry: 5000\nevent: connected\ndata: ${JSON.stringify({ status: "listening" })}\n\n`);

  // Periodic heartbeat to prevent proxy timeouts (every 10 seconds with a real ping event)
  const heartbeat = setInterval(() => {
    try {
      res.write(`event: ping\ndata: ${JSON.stringify({ time: Date.now() })}\n\n`);
    } catch (err) {
      clearInterval(heartbeat);
      sseClients.delete(res);
    }
  }, 10000);

  req.on("close", () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
});

// Helper to mask connection credentials for user display safety
function maskConnectionString(connStr: string): string {
  try {
    const url = new URL(connStr);
    if (url.password) {
      url.password = "••••••••";
    }
    return url.toString();
  } catch (e) {
    // Basic regex fallback if not standard URL
    return connStr.replace(/:([^:@]+)@/, ":••••••••@");
  }
}

async function startServer() {
  // Initialize Database (SQLite/JSON or Postgres)
  const pStatus = await initDb();
  // Initialize Redis Cache (Memory map or Redis)
  const rStatus = await initRedis();

  dbStatus = {
    postgres: pStatus.postgres,
    redis: rStatus.status,
    postgresUrl: pStatus.postgresUrl,
    redisUrl: rStatus.url
  };

  // Mount Vite middleware for development, serve index.html for production
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`[Sovereign Core] Server boot successful. Access client running on port ${PORT}`);
  });
}

startServer();
