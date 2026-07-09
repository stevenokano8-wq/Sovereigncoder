import React, { useState, useEffect, useRef, useMemo } from "react";
import { Terminal, Check, AlertTriangle, Search, Trash2, Cpu, Activity, Database, Copy, Play, RefreshCw, X, ArrowRight } from "lucide-react";
import { motion } from "motion/react";
import { Task, FileNode } from "../types.js";

interface TerminalLogsViewProps {
  tasks: Task[];
  files: FileNode[];
  dbStatus: {
    postgres: string;
    redis: string;
    postgresUrl: string;
    redisUrl: string;
  };
}

interface LogEntry {
  id: string;
  timestamp: string;
  source: "SYSTEM" | "COMPILER" | "AGENT" | "CLI" | "FILESYSTEM" | "NETWORK";
  text: string;
  type: "info" | "success" | "warn" | "error" | "command";
}

export default function TerminalLogsView({ tasks, files, dbStatus }: TerminalLogsViewProps) {
  const [filter, setFilter] = useState<"all" | "system" | "agent" | "cli" | "errors">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [cliInput, setCliInput] = useState("");
  const [cpuUsage, setCpuUsage] = useState(12);
  const [ramUsage, setRamUsage] = useState(1.2);
  const [commandHistory, setCommandHistory] = useState<LogEntry[]>([]);
  const [isCopied, setIsCopied] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);

  // Mask sensitive connections
  const maskUrl = (urlStr: string) => {
    if (!urlStr) return "N/A";
    try {
      const parsed = new URL(urlStr);
      if (parsed.password) parsed.password = "••••••••";
      return parsed.toString();
    } catch {
      return urlStr.replace(/:([^:@]+)@/, ":••••••••@");
    }
  };

  // Simulate hardware metrics shifts
  useEffect(() => {
    const timer = setInterval(() => {
      setCpuUsage(prev => {
        const delta = Math.floor(Math.random() * 9) - 4; // -4% to +4%
        const isRunning = tasks.some(t => t.status === "running");
        const base = isRunning ? 65 : 12;
        return Math.min(Math.max(base + delta, 2), 99);
      });
      setRamUsage(prev => {
        const isRunning = tasks.some(t => t.status === "running");
        const base = isRunning ? 2.3 : 1.25;
        const delta = Number((Math.random() * 0.1 - 0.05).toFixed(2));
        return Math.min(Math.max(base + delta, 0.8), 3.9);
      });
    }, 3000);
    return () => clearInterval(timer);
  }, [tasks]);

  // Generate live logs from tasks/subtasks + system boot info + user commands
  const allLogs = useMemo<LogEntry[]>(() => {
    const logs: LogEntry[] = [];

    // 1. Initial System Boot logs
    const bootTime = new Date();
    bootTime.setMinutes(bootTime.getMinutes() - 10);
    
    logs.push({
      id: "boot-1",
      timestamp: bootTime.toLocaleTimeString(),
      source: "SYSTEM",
      text: "Sovereign Build Container Engine v1.0.4 - starting up...",
      type: "info"
    });
    
    bootTime.setSeconds(bootTime.getSeconds() + 3);
    logs.push({
      id: "boot-2",
      timestamp: bootTime.toLocaleTimeString(),
      source: "SYSTEM",
      text: "Network routing active. Ingress port 3000 binds cleanly.",
      type: "success"
    });

    if (dbStatus.postgresUrl) {
      bootTime.setSeconds(bootTime.getSeconds() + 2);
      logs.push({
        id: "boot-db-1",
        timestamp: bootTime.toLocaleTimeString(),
        source: "SYSTEM",
        text: `Configuring PostgreSQL connection pool. Target: ${maskUrl(dbStatus.postgresUrl)}`,
        type: "info"
      });
      bootTime.setSeconds(bootTime.getSeconds() + 1);
      logs.push({
        id: "boot-db-2",
        timestamp: bootTime.toLocaleTimeString(),
        source: "SYSTEM",
        text: `Postgres connection authenticated. Engine state: [${dbStatus.postgres}]`,
        type: "success"
      });
    }

    if (dbStatus.redisUrl) {
      bootTime.setSeconds(bootTime.getSeconds() + 1);
      logs.push({
        id: "boot-redis-1",
        timestamp: bootTime.toLocaleTimeString(),
        source: "SYSTEM",
        text: `Connecting to Redis cluster cache: ${maskUrl(dbStatus.redisUrl)}`,
        type: "info"
      });
      logs.push({
        id: "boot-redis-2",
        timestamp: bootTime.toLocaleTimeString(),
        source: "SYSTEM",
        text: `Redis operational. Cache channel state: [${dbStatus.redis}]`,
        type: "success"
      });
    }

    // 2. Add logs from task execution stream
    tasks.forEach((task, tIdx) => {
      task.subtasks.forEach((subtask, sIdx) => {
        subtask.logs.forEach((logLine, lIdx) => {
          // Parse time if it exists
          const match = logLine.match(/^\[([^\]]+)\]\s*(.*)$/);
          let time = new Date(task.createdAt || Date.now()).toLocaleTimeString();
          let rawText = logLine;
          if (match) {
            time = match[1];
            rawText = match[2];
          }

          let type: "info" | "success" | "warn" | "error" = "info";
          const lower = rawText.toLowerCase();
          if (lower.includes("success") || lower.includes("completed") || lower.includes("finished")) {
            type = "success";
          } else if (lower.includes("warn") || lower.includes("warning")) {
            type = "warn";
          } else if (lower.includes("error") || lower.includes("fail") || lower.includes("failed")) {
            type = "error";
          }

          logs.push({
            id: `agent-log-${task.id}-${sIdx}-${lIdx}`,
            timestamp: time,
            source: "AGENT",
            text: `[${task.name.substring(0, 20)}...] ${rawText}`,
            type
          });
        });
      });
    });

    // 3. Add CLI custom execution log history
    const combined = [...logs, ...commandHistory];

    // Sort by timestamp if possible, otherwise preserve logical insertion order
    return combined;
  }, [tasks, dbStatus, commandHistory]);

  // Filter and search logs
  const filteredLogs = useMemo(() => {
    return allLogs.filter(log => {
      // Filter by type
      if (filter === "system" && log.source !== "SYSTEM") return false;
      if (filter === "agent" && log.source !== "AGENT") return false;
      if (filter === "cli" && log.source !== "CLI") return false;
      if (filter === "errors" && log.type !== "error" && log.type !== "warn") return false;

      // Filter by Search Query
      if (searchQuery.trim() !== "") {
        const query = searchQuery.toLowerCase();
        return (
          log.text.toLowerCase().includes(query) ||
          log.source.toLowerCase().includes(query) ||
          log.timestamp.toLowerCase().includes(query)
        );
      }

      return true;
    });
  }, [allLogs, filter, searchQuery]);

  // Auto Scroll
  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [filteredLogs]);

  // Handle CLI Mock Commands
  const handleCliSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!cliInput.trim()) return;

    const command = cliInput.trim();
    const timeStr = new Date().toLocaleTimeString();
    const newLogs: LogEntry[] = [];

    // Append the entered command to command history
    newLogs.push({
      id: `cli-cmd-${Date.now()}`,
      timestamp: timeStr,
      source: "CLI",
      text: `$ ${command}`,
      type: "command"
    });

    const lowerCmd = command.toLowerCase();

    if (lowerCmd === "help") {
      newLogs.push({
        id: `cli-res-${Date.now()}-1`,
        timestamp: timeStr,
        source: "CLI",
        text: "Sovereign Agent CLI - Available Commands:\n  help      - Show this menu\n  clear     - Clear CLI execution history\n  ls        - List synced files\n  neofetch  - Display system and build specs\n  status    - Show active database, caching, and task engine telemetry\n  top       - Check CPU, Memory, and streaming SSE threads\n  ping      - Test response speeds of cloud backends",
        type: "info"
      });
    } else if (lowerCmd === "clear") {
      setCommandHistory([]);
      setCliInput("");
      return;
    } else if (lowerCmd === "ls") {
      if (files.length === 0) {
        newLogs.push({
          id: `cli-res-${Date.now()}-empty`,
          timestamp: timeStr,
          source: "CLI",
          text: "No files found in current workspace. Sync or clone a repository first.",
          type: "warn"
        });
      } else {
        const fileLines = files.map(f => `  - ${f.path} (${f.language}) - ${f.content.length} bytes`).join("\n");
        newLogs.push({
          id: `cli-res-${Date.now()}-ls`,
          timestamp: timeStr,
          source: "CLI",
          text: `Total Modules in Workspace: ${files.length}\n${fileLines}`,
          type: "success"
        });
      }
    } else if (lowerCmd === "neofetch") {
      newLogs.push({
        id: `cli-res-${Date.now()}-neofetch`,
        timestamp: timeStr,
        source: "CLI",
        text: `
    /\\_/\\      Sovereign VM @ Cloud-Run
   ( o.o )     ------------------------
    > ^ <      OS: Sovereign Agent Linux 1.0
               Kernel: Sandbox-Container-x86_64
               Shell: sovereign-sh v1.0.4
               Uptime: 27 mins
               Packages: React-Vite v5.2, Tailwind v4
               Port bindings: 0.0.0.0:3000 -> Reverse Proxy
               Database: Postgres (${dbStatus.postgres})
               Cache: Redis (${dbStatus.redis})
      `,
        type: "info"
      });
    } else if (lowerCmd === "status") {
      newLogs.push({
        id: `cli-res-${Date.now()}-status`,
        timestamp: timeStr,
        source: "CLI",
        text: `[TELEMETRY REPORT]\n- PostgreSQL pool state: ${dbStatus.postgres}\n- PostgreSQL target: ${maskUrl(dbStatus.postgresUrl)}\n- Redis Caching status: ${dbStatus.redis}\n- Redis Target: ${maskUrl(dbStatus.redisUrl)}\n- Active Tasks: ${tasks.filter(t => t.status === "running").length} running / ${tasks.length} total`,
        type: "info"
      });
    } else if (lowerCmd === "top") {
      newLogs.push({
        id: `cli-res-${Date.now()}-top`,
        timestamp: timeStr,
        source: "CLI",
        text: `[SYSTEM STATUS]\n- CPU Utilization: ${cpuUsage}%\n- Memory footprint: ${ramUsage}GB / 4.00GB\n- Storage footprint: 242MB / 10GB\n- Real-time stream (SSE) connections: Active (1 listener)`,
        type: "info"
      });
    } else if (lowerCmd.startsWith("ping")) {
      newLogs.push({
        id: `cli-res-${Date.now()}-ping-1`,
        timestamp: timeStr,
        source: "CLI",
        text: `PING server-clusters (0.0.0.0:3000) 56(84) bytes of data.\n64 bytes from local_host: icmp_seq=1 ttl=64 time=0.045 ms\n64 bytes from local_host: icmp_seq=2 ttl=64 time=0.038 ms\n\n--- server-clusters ping statistics ---\n2 packets transmitted, 2 received, 0% packet loss, time 1002ms\nrtt min/avg/max/mdev = 0.038/0.041/0.045/0.005 ms`,
        type: "success"
      });
    } else if (lowerCmd.startsWith("cat ")) {
      const targetPath = command.substring(4).trim();
      const file = files.find(f => f.path.toLowerCase().includes(targetPath.toLowerCase()));
      if (file) {
        newLogs.push({
          id: `cli-res-${Date.now()}-cat`,
          timestamp: timeStr,
          source: "CLI",
          text: `[FILE CONTENT] - ${file.path} (${file.language}):\n\n${file.content.substring(0, 1000)}${file.content.length > 1000 ? "\n... (truncated)" : ""}`,
          type: "info"
        });
      } else {
        newLogs.push({
          id: `cli-res-${Date.now()}-cat-err`,
          timestamp: timeStr,
          source: "CLI",
          text: `File "${targetPath}" not found. Type 'ls' to see workspace paths.`,
          type: "error"
        });
      }
    } else {
      newLogs.push({
        id: `cli-res-${Date.now()}-unknown`,
        timestamp: timeStr,
        source: "CLI",
        text: `command not found: ${command}. Type 'help' for a full command inventory.`,
        type: "error"
      });
    }

    setCommandHistory(prev => [...prev, ...newLogs]);
    setCliInput("");
  };

  const handleCopyLogs = () => {
    const rawText = filteredLogs.map(l => `[${l.timestamp}] [${l.source}] ${l.text}`).join("\n");
    navigator.clipboard.writeText(rawText);
    setIsCopied(true);
    setTimeout(() => setIsCopied(false), 2000);
  };

  const handleClearTerminal = () => {
    setCommandHistory([]);
  };

  return (
    <div id="terminal-logs-root" className="flex-1 flex flex-col min-h-0 bg-gray-950 rounded-3xl border border-gray-800 shadow-2xl overflow-hidden font-mono">
      {/* Terminal Header */}
      <div className="bg-gray-900 px-5 py-3 border-b border-gray-800 flex flex-wrap items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 mr-2">
            <span className="w-3 h-3 rounded-full bg-red-500 block opacity-80" />
            <span className="w-3 h-3 rounded-full bg-yellow-500 block opacity-80" />
            <span className="w-3 h-3 rounded-full bg-green-500 block opacity-80" />
          </div>
          <Terminal className="h-4 w-4 text-emerald-400" />
          <span className="text-xs font-bold text-gray-200 tracking-wider font-mono">TERMINAL SERVICE CONSOLE</span>
          <span className="bg-emerald-950/80 text-emerald-400 border border-emerald-800/60 px-2 py-0.5 rounded text-[10px] animate-pulse font-bold flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 block" /> LIVE STREAM
          </span>
        </div>

        {/* Telemetry quick status chips */}
        <div className="flex items-center gap-4 text-[10px] text-gray-400 border-l border-gray-800 pl-4">
          <div className="flex items-center gap-1.5">
            <Cpu className="h-3.5 w-3.5 text-sky-400" />
            <span>CPU: <b className="text-gray-200">{cpuUsage}%</b></span>
          </div>
          <div className="flex items-center gap-1.5">
            <Activity className="h-3.5 w-3.5 text-purple-400" />
            <span>RAM: <b className="text-gray-200">{ramUsage}GB</b>/4GB</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Database className="h-3.5 w-3.5 text-amber-400" />
            <span>DB: <b className="text-emerald-400">Postgres</b></span>
          </div>
        </div>
      </div>

      {/* Control Utility Toolbar */}
      <div className="bg-gray-950/40 px-5 py-2.5 border-b border-gray-900 flex flex-wrap items-center justify-between gap-3 shrink-0">
        {/* Filters */}
        <div className="flex items-center gap-1 bg-gray-900 p-0.5 rounded-lg border border-gray-800">
          {[
            { id: "all", name: "All Stream" },
            { id: "system", name: "System" },
            { id: "agent", name: "Agent Build" },
            { id: "cli", name: "CLI History" },
            { id: "errors", name: "Errors/Warnings" }
          ].map(btn => (
            <button
              key={btn.id}
              onClick={() => setFilter(btn.id as any)}
              className={`px-2.5 py-1 rounded-md text-[10px] font-bold transition-all ${
                filter === btn.id
                  ? "bg-gray-800 text-white shadow-inner"
                  : "text-gray-500 hover:text-gray-300"
              }`}
            >
              {btn.name}
            </button>
          ))}
        </div>

        {/* Search & Actions */}
        <div className="flex items-center gap-2">
          {/* Search bar */}
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-gray-500" />
            <input
              type="text"
              placeholder="Search console logs..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="pl-8 pr-3 py-1 bg-gray-900 border border-gray-800 text-[10px] text-gray-200 rounded-lg focus:outline-none focus:border-gray-700 w-36 sm:w-48 placeholder-gray-600"
            />
            {searchQuery && (
              <button onClick={() => setSearchQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-white">
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          <button
            onClick={handleCopyLogs}
            className="p-1.5 bg-gray-900 border border-gray-800 text-gray-400 hover:text-white rounded-lg transition-colors flex items-center gap-1 text-[10px] px-2"
            title="Copy Logs"
          >
            <Copy className="h-3.5 w-3.5" />
            <span>{isCopied ? "Copied!" : "Copy"}</span>
          </button>

          <button
            onClick={handleClearTerminal}
            className="p-1.5 bg-gray-900 border border-gray-800 text-gray-400 hover:text-rose-400 rounded-lg transition-colors flex items-center gap-1 text-[10px] px-2"
            title="Clear Custom Logs"
          >
            <Trash2 className="h-3.5 w-3.5" />
            <span>Reset CLI</span>
          </button>
        </div>
      </div>

      {/* Terminal logs content box */}
      <div
        ref={containerRef}
        className="flex-1 p-5 overflow-y-auto space-y-2 bg-black select-text scrollbar-thin scrollbar-thumb-gray-800 scrollbar-track-transparent"
      >
        {filteredLogs.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center text-gray-600 gap-2 py-10">
            <Terminal className="h-8 w-8 text-gray-700" />
            <p className="text-xs">No logs matching active filter: "{filter}"</p>
          </div>
        ) : (
          filteredLogs.map((log) => {
            // Apply line-by-line formatting
            let textClass = "text-gray-300";
            let prefix = "";

            if (log.type === "success") {
              textClass = "text-emerald-400";
              prefix = "✔";
            } else if (log.type === "warn") {
              textClass = "text-amber-400 font-medium";
              prefix = "⚠";
            } else if (log.type === "error") {
              textClass = "text-rose-400 font-bold bg-rose-950/20 px-1 py-0.5 rounded";
              prefix = "✘";
            } else if (log.type === "command") {
              textClass = "text-sky-300 font-semibold";
            }

            return (
              <div
                key={log.id}
                className={`text-[11px] leading-relaxed break-all flex items-start gap-2.5 transition-all hover:bg-gray-900/45 py-0.5 px-1 rounded`}
              >
                {/* Time stamp */}
                <span className="text-gray-600 select-none shrink-0 text-[10px] mt-0.5">[{log.timestamp}]</span>
                
                {/* Source badge */}
                <span className={`px-1.5 py-0.5 rounded text-[8px] font-bold shrink-0 tracking-wider ${
                  log.source === "SYSTEM" ? "bg-purple-950/40 text-purple-400 border border-purple-900/40" :
                  log.source === "AGENT" ? "bg-emerald-950/40 text-emerald-400 border border-emerald-900/40" :
                  log.source === "CLI" ? "bg-sky-950/40 text-sky-400 border border-sky-900/40" :
                  "bg-gray-850 text-gray-400"
                }`}>
                  {log.source}
                </span>

                {/* Main Log text */}
                <div className={`flex-1 whitespace-pre-wrap ${textClass}`}>
                  {prefix && <span className="mr-1.5 font-bold">{prefix}</span>}
                  {log.text}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Terminal Interactive Input Box */}
      <form onSubmit={handleCliSubmit} className="bg-gray-900/90 px-5 py-3 border-t border-gray-800 flex items-center gap-3 shrink-0">
        <span className="text-emerald-400 font-bold text-xs shrink-0 select-none">sovereign-agent:~$</span>
        <input
          type="text"
          value={cliInput}
          onChange={e => setCliInput(e.target.value)}
          placeholder="Type an interactive command (e.g. 'help', 'neofetch', 'ls', 'status', 'top')..."
          className="flex-1 bg-transparent text-gray-200 placeholder-gray-600 text-xs focus:outline-none focus:ring-0 border-none p-0 selection:bg-emerald-800/60"
        />
        <button
          type="submit"
          className="text-gray-500 hover:text-emerald-400 transition-colors shrink-0 p-1 rounded hover:bg-gray-800"
        >
          <ArrowRight className="h-4 w-4" />
        </button>
      </form>
    </div>
  );
}
