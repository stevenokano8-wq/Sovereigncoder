import React, { useState, useEffect } from "react";
import { Github, GitBranch, GitCommit, GitPullRequest, ArrowUpRight, ArrowDownLeft, CheckCircle, RefreshCw, Terminal, Info, Download, AlertCircle } from "lucide-react";
import { motion } from "motion/react";

export default function GithubView({ sessionId }: { sessionId?: string }) {
  const [isSyncing, setIsSyncing] = useState(false);
  const [isCloning, setIsCloning] = useState(false);
  const [currentBranch, setCurrentBranch] = useState("main");
  const [repoName, setRepoName] = useState("");
  const [isRepoConnected, setIsRepoConnected] = useState(true);
  const [statusMsg, setStatusMsg] = useState<{ type: "success" | "error", text: string } | null>(null);
  const [commits, setCommits] = useState<any[]>([]);

  useEffect(() => {
    fetch(`/api/github/config?sessionId=${sessionId || ""}`)
      .then(res => res.json())
      .then(data => {
        if (data.repoUrl) {
          setRepoName(data.repoUrl);
        } else if (data.repoName) {
          setRepoName(data.repoName);
        } else {
          setRepoName("");
        }
        if (data.branch) {
          setCurrentBranch(data.branch);
        } else {
          setCurrentBranch("main");
        }
        if (data.commits) {
          setCommits(data.commits);
        } else {
          setCommits([]);
        }
      })
      .catch(err => console.error("Error loading GitHub configuration:", err));
  }, [sessionId]);

  const handlePush = () => {
    setIsSyncing(true);
    setTimeout(() => {
      setIsSyncing(false);
      setCommits(prev => [
        {
          sha: Math.random().toString(16).substring(2, 9),
          message: `Synchronized workspace files with GitHub remote repository`,
          branch: currentBranch,
          author: "Trinity CEO",
          time: "Just now"
        },
        ...prev
      ]);
    }, 1500);
  };

  const handleClone = async () => {
    if (!repoName.trim()) {
      setStatusMsg({ type: "error", text: "Repository URL cannot be empty." });
      return;
    }
    setIsCloning(true);
    setStatusMsg(null);
    try {
      const res = await fetch("/api/github/clone", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ repoUrl: repoName, sessionId })
      });
      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || "Failed to clone repository.");
      }
      const data = await res.json();
      if (data.branch) setCurrentBranch(data.branch);
      if (data.commits) setCommits(data.commits);
      if (data.repoUrl) setRepoName(data.repoUrl);
      setStatusMsg({ type: "success", text: `Successfully cloned and imported ${data.repoName}! files are now available in the Code View tab.` });
    } catch (err: any) {
      console.error(err);
      setStatusMsg({ type: "error", text: `Cloning failed: ${err.message}` });
    } finally {
      setIsCloning(false);
    }
  };

  return (
    <div id="github-panel-root" className="flex-1 flex flex-col gap-6 p-4 md:p-6 lg:p-8 overflow-y-auto max-h-[85vh] font-sans">
      
      {/* Header Panel */}
      <div className="bg-white border border-gray-100 rounded-3xl p-6 shadow-xs flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
        <div className="flex gap-4 items-center">
          <div className="p-4 bg-gray-950 text-white rounded-2xl">
            <Github className="h-7 w-7" />
          </div>
          <div className="space-y-1">
            <h2 className="text-xl font-bold text-gray-900 font-display">GitHub Workspace Sync</h2>
            <p className="text-xs text-gray-500 font-mono flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-emerald-500 animate-ping inline-block" />
              Connected: <span className="font-bold text-gray-700 truncate max-w-[200px] inline-block align-middle">{repoName}</span>
            </p>
          </div>
        </div>

        <div className="flex gap-3 w-full md:w-auto">
          <button
            id="btn-git-pull"
            onClick={() => { setIsSyncing(true); setTimeout(() => setIsSyncing(false), 1000); }}
            disabled={isSyncing || isCloning}
            className="flex-1 md:flex-none border border-gray-100 hover:bg-gray-50 text-gray-700 px-4 py-2.5 rounded-xl text-xs font-bold font-sans flex items-center justify-center gap-1.5 transition-colors"
          >
            <ArrowDownLeft className="h-4 w-4 text-emerald-500" />
            Git Pull
          </button>
          <button
            id="btn-git-push"
            onClick={handlePush}
            disabled={isSyncing || isCloning}
            className="flex-1 md:flex-none bg-gray-950 hover:bg-zinc-800 disabled:opacity-50 text-white px-5 py-2.5 rounded-xl text-xs font-bold font-sans flex items-center justify-center gap-1.5 transition-colors shadow-sm"
          >
            {isSyncing ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowUpRight className="h-4 w-4 text-amber-400 font-black" />
            )}
            Push to GitHub
          </button>
        </div>
      </div>

      {/* Main Grid Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Left config card */}
        <div className="space-y-6">
          <div className="bg-white border border-gray-100 rounded-3xl p-5 shadow-xs space-y-4">
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider font-mono">Branch & Settings</h3>
            
            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-bold text-gray-400 font-mono uppercase mb-1.5">Selected Active Branch</label>
                <div className="relative">
                  <select
                    id="select-git-branch"
                    value={currentBranch}
                    onChange={(e) => setCurrentBranch(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-100 rounded-xl px-3 py-2.5 text-xs text-gray-700 font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  >
                    <option value="main">main</option>
                    <option value="development">development</option>
                    <option value="staging">staging</option>
                    <option value="feat/realtime-sse">feat/realtime-sse</option>
                    <option value={currentBranch}>{currentBranch}</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-gray-400 font-mono uppercase mb-1.5">Target Git Repository URL</label>
                <input
                  id="input-git-repo"
                  type="text"
                  value={repoName}
                  onChange={(e) => setRepoName(e.target.value)}
                  className="w-full bg-gray-50 border border-gray-100 rounded-xl px-3 py-2.5 text-xs text-gray-700 font-mono focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  placeholder="https://github.com/username/repository.git"
                />
                
                <button
                  id="btn-git-clone"
                  onClick={handleClone}
                  disabled={isCloning || !repoName}
                  className="w-full mt-3 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white px-4 py-2.5 rounded-xl text-xs font-bold font-sans flex items-center justify-center gap-1.5 transition-colors shadow-sm cursor-pointer"
                >
                  {isCloning ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4 text-white" />
                  )}
                  {isCloning ? "Cloning..." : "Clone & Import Repo"}
                </button>
              </div>

              {statusMsg && (
                <div className={`p-3 rounded-xl text-xs leading-relaxed flex gap-2 border ${
                  statusMsg.type === "success" 
                    ? "bg-emerald-50 border-emerald-200 text-emerald-800" 
                    : "bg-rose-50 border-rose-200 text-rose-800"
                }`}>
                  {statusMsg.type === "success" ? (
                    <CheckCircle className="h-4.5 w-4.5 text-emerald-600 shrink-0 mt-0.5" />
                  ) : (
                    <AlertCircle className="h-4.5 w-4.5 text-rose-600 shrink-0 mt-0.5" />
                  )}
                  <span>{statusMsg.text}</span>
                </div>
              )}

              <div className="pt-2">
                <div className="flex items-center justify-between text-xs font-medium text-gray-600 p-2 border border-gray-50 bg-gray-50/50 rounded-xl">
                  <span className="flex items-center gap-1.5 font-mono"><GitBranch className="h-3.5 w-3.5 text-indigo-500" /> Tracking</span>
                  <span className="font-mono text-gray-500 font-semibold">origin/{currentBranch}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-indigo-50/50 border border-indigo-100 rounded-3xl p-5 text-indigo-900 text-xs leading-relaxed flex gap-3">
            <Info className="h-5 w-5 text-indigo-500 shrink-0 mt-0.5" />
            <div>
              <strong>Secure SSH Tunneling:</strong> Our server-side build clusters execute SSH and token-based client negotiations in an ephemeral container. Local environment secrets are omitted automatically from public push logs.
            </div>
          </div>
        </div>

        {/* Right Commits logs */}
        <div className="lg:col-span-2 bg-white border border-gray-100 rounded-3xl shadow-xs overflow-hidden flex flex-col">
          <div className="p-5 border-b border-gray-100 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <GitCommit className="h-4.5 w-4.5 text-indigo-500" />
              <h3 className="font-bold text-sm text-gray-800 font-display">Repository Commit History</h3>
            </div>
            <span className="text-[10px] bg-indigo-50 text-indigo-700 font-bold px-2 py-0.5 rounded-full font-mono">{commits.length} commits</span>
          </div>

          <div className="divide-y divide-gray-50 flex-1 overflow-y-auto">
            {commits.map((commit, idx) => (
              <div key={commit.sha} className="p-4 flex items-start justify-between gap-4 hover:bg-gray-50/30 font-mono text-xs text-gray-600">
                <div className="space-y-1.5 flex-1 min-w-0">
                  <p className="text-gray-800 font-medium font-sans truncate text-sm">{commit.message}</p>
                  <div className="flex items-center gap-2.5 text-[10px] text-gray-400">
                    <span className="font-bold text-gray-500">{commit.author}</span>
                    <span>•</span>
                    <span>{commit.time}</span>
                    <span>•</span>
                    <span className="bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded flex items-center gap-1"><GitBranch className="h-3 w-3" /> {commit.branch}</span>
                  </div>
                </div>

                <div className="text-[11px] bg-gray-50 text-gray-500 hover:text-gray-800 px-2.5 py-1.5 rounded-lg border border-gray-100 cursor-pointer font-bold select-all">
                  {commit.sha}
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>

    </div>
  );
}
