import React, { useState, useEffect } from "react";
import { FileNode } from "../types.js";
import { 
  FileText, Folder, FolderOpen, HardDrive, Edit3, Code, Save, Check, 
  Menu, ArrowLeft, Laptop, ChevronDown, ChevronRight,
  FilePlus, FolderPlus, Trash2, Plus, X, AlertCircle
} from "lucide-react";

export interface TreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children: { [key: string]: TreeNode };
  file?: FileNode;
}

export function buildTree(files: FileNode[]): TreeNode {
  const root: TreeNode = {
    name: "root",
    path: "",
    isDirectory: true,
    children: {},
  };

  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    let current = root;
    let accumulatedPath = "";

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      accumulatedPath = accumulatedPath ? `${accumulatedPath}/${part}` : part;
      const isLast = i === parts.length - 1;

      if (!current.children[part]) {
        current.children[part] = {
          name: part,
          path: isLast ? file.path : `dir:${accumulatedPath}`,
          isDirectory: !isLast,
          children: {},
          file: isLast ? file : undefined,
        };
      }
      current = current.children[part];
    }
  }

  return root;
}

interface CodeViewProps {
  files: FileNode[];
  onUpdateFile: (path: string, newContent: string) => void;
  initialSelectedPath?: string | null;
  onRefreshFiles?: () => void;
}

export default function CodeView({ files, onUpdateFile, initialSelectedPath, onRefreshFiles }: CodeViewProps) {
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(
    initialSelectedPath || (files.length > 0 ? files[0].path : null)
  );
  const [editorContent, setEditorContent] = useState("");
  const [isEditing, setIsEditing] = useState(false);
  const [saveStatus, setSaveStatus] = useState<"idle" | "unsaved" | "saving" | "saved">("idle");
  const [mobileView, setMobileView] = useState<"tree" | "editor">("tree");
  const [expandedDirs, setExpandedDirs] = useState<Record<string, boolean>>({});

  // Right-click context menu state
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    nodePath: string;
    isDirectory: boolean;
    cleanPath: string;
    nodeName: string;
  } | null>(null);

  // File operation modal state
  const [modal, setModal] = useState<{
    type: "create_file" | "create_folder" | "rename" | "delete";
    nodePath: string;
    cleanPath: string;
    isDirectory: boolean;
    currentValue: string;
    newValue: string;
  } | null>(null);

  // Close context menu on any document-wide click
  useEffect(() => {
    const handleOutsideClick = () => {
      setContextMenu(null);
    };
    window.addEventListener("click", handleOutsideClick);
    return () => window.removeEventListener("click", handleOutsideClick);
  }, []);

  const openModal = (
    type: "create_file" | "create_folder" | "rename" | "delete",
    nodePath: string,
    cleanPath: string,
    isDirectory: boolean
  ) => {
    const currentValue = isDirectory ? cleanPath.split("/").pop() || "" : cleanPath.split("/").pop() || "";
    setModal({
      type,
      nodePath,
      cleanPath,
      isDirectory,
      currentValue,
      newValue: type === "rename" ? cleanPath : ""
    });
  };

  const handleExecuteFileOp = async () => {
    if (!modal) return;
    const { type, cleanPath, isDirectory, newValue } = modal;
    
    try {
      if (type === "create_file") {
        if (!newValue.trim()) return;
        // Construct target path relative to current clicked folder
        const parentPrefix = cleanPath ? `${cleanPath}/` : "";
        const targetPath = `${parentPrefix}${newValue.trim()}`;
        
        const ext = targetPath.split(".").pop() || "";
        let language = "typescript";
        if (["ts", "tsx"].includes(ext)) language = "typescript";
        else if (["js", "jsx"].includes(ext)) language = "javascript";
        else if (ext === "json") language = "json";
        else if (ext === "css") language = "css";
        else if (ext === "html") language = "html";
        else if (ext === "md") language = "markdown";

        const res = await fetch("/api/files/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: targetPath, content: "", language }),
        });
        
        if (res.ok) {
          setSelectedFilePath(targetPath);
          if (onRefreshFiles) onRefreshFiles();
        }
      } else if (type === "create_folder") {
        if (!newValue.trim()) return;
        const parentPrefix = cleanPath ? `${cleanPath}/` : "";
        const targetPath = `${parentPrefix}${newValue.trim()}/.gitkeep`;

        const res = await fetch("/api/files/save", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: targetPath, content: "", language: "markdown" }),
        });
        
        if (res.ok) {
          if (onRefreshFiles) onRefreshFiles();
        }
      } else if (type === "rename") {
        if (!newValue.trim() || newValue.trim() === cleanPath) return;
        
        const res = await fetch("/api/files/rename", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ oldPath: cleanPath, newPath: newValue.trim(), isDirectory }),
        });
        
        if (res.ok) {
          if (!isDirectory) {
            setSelectedFilePath(newValue.trim());
          } else {
            if (selectedFilePath && selectedFilePath.startsWith(cleanPath + "/")) {
              setSelectedFilePath(selectedFilePath.replace(cleanPath + "/", newValue.trim() + "/"));
            }
          }
          if (onRefreshFiles) onRefreshFiles();
        }
      } else if (type === "delete") {
        const res = await fetch("/api/files/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ path: cleanPath, isDirectory }),
        });
        
        if (res.ok) {
          if (isDirectory) {
            if (selectedFilePath && selectedFilePath.startsWith(cleanPath + "/")) {
              setSelectedFilePath(null);
            }
          } else {
            if (selectedFilePath === cleanPath) {
              setSelectedFilePath(null);
            }
          }
          if (onRefreshFiles) onRefreshFiles();
        }
      }
    } catch (err) {
      console.error(`Failed to execute file operation ${type}:`, err);
    } finally {
      setModal(null);
    }
  };

  // Sync selected path if updated by parent (e.g. from Smart Summary Card click)
  React.useEffect(() => {
    if (initialSelectedPath) {
      setSelectedFilePath(initialSelectedPath);
      setMobileView("editor");
    }
  }, [initialSelectedPath]);

  // Ref trackers for auto-detecting updates from agent
  const prevFilesLengthRef = React.useRef(files.length);
  const prevFilesRef = React.useRef(files);

  const selectedFile = files.find(f => f.path === selectedFilePath) || files[0];

  React.useEffect(() => {
    // If the list of files grows or a file content was modified by the agent, auto-select the most recently mutated file!
    if (files.length > 0) {
      if (files.length > prevFilesLengthRef.current) {
        // New file added! Select the newest one
        const newestFile = files[files.length - 1];
        setSelectedFilePath(newestFile.path);
      } else {
        // Check if any file content was modified (updated) compared to previous files
        const changedFile = files.find((f, idx) => {
          const prevF = prevFilesRef.current[idx];
          return prevF && prevF.path === f.path && prevF.content !== f.content;
        });
        if (changedFile) {
          setSelectedFilePath(changedFile.path);
        }
      }
    }
    prevFilesLengthRef.current = files.length;
    prevFilesRef.current = files;
  }, [files]);

  // Only reset editor content and exit edit mode when selecting a DIFFERENT file path
  React.useEffect(() => {
    if (selectedFile) {
      setEditorContent(selectedFile.content);
      setIsEditing(false);
      setSaveStatus("idle");
    }
  }, [selectedFilePath]);

  // Sync content if updated from outside (e.g. by agent) only when we are NOT in active edit mode
  React.useEffect(() => {
    if (selectedFile && !isEditing) {
      setEditorContent(selectedFile.content);
    }
  }, [selectedFile, isEditing]);

  // Debounced auto-save effect
  React.useEffect(() => {
    if (!isEditing || !selectedFile || editorContent === selectedFile.content) {
      return;
    }

    setSaveStatus("unsaved");

    const timer = setTimeout(async () => {
      setSaveStatus("saving");
      try {
        await onUpdateFile(selectedFile.path, editorContent);
        setSaveStatus("saved");
      } catch (err) {
        console.error("Auto-save failed:", err);
        setSaveStatus("unsaved");
      }
    }, 1000); // 1000ms debounce auto-save

    return () => clearTimeout(timer);
  }, [editorContent, isEditing, selectedFile, onUpdateFile]);

  // Construct files tree representation
  const tree = React.useMemo(() => buildTree(files), [files]);

  // Auto-expand any folder directory inside the tree on first render
  React.useEffect(() => {
    const newExpanded = { ...expandedDirs };
    let changed = false;

    const autoExpand = (node: TreeNode) => {
      if (node.isDirectory && node.path && expandedDirs[node.path] === undefined) {
        newExpanded[node.path] = true;
        changed = true;
      }
      Object.values(node.children).forEach(autoExpand);
    };

    autoExpand(tree);
    if (changed) {
      setExpandedDirs(newExpanded);
    }
  }, [tree]);

  const handleSave = async () => {
    if (selectedFile) {
      setSaveStatus("saving");
      try {
        await onUpdateFile(selectedFile.path, editorContent);
        setSaveStatus("saved");
        setIsEditing(false);
      } catch (err) {
        console.error("Manual save failed:", err);
        setSaveStatus("unsaved");
      }
    }
  };

  // Beautiful recursive tree rendering function
  const renderNode = (node: TreeNode, depth: number = 0) => {
    const sortedChildren = Object.values(node.children).sort((a, b) => {
      if (a.isDirectory && !b.isDirectory) return -1;
      if (!a.isDirectory && b.isDirectory) return 1;
      return a.name.localeCompare(b.name);
    });

    const isExpanded = expandedDirs[node.path] ?? true;

    return (
      <div key={node.path || "root"} className="space-y-1">
        {node.path && (
          <button
            id={`file-node-${node.path.replace(/[^a-z0-9]/g, "-")}`}
            onClick={() => {
              if (node.isDirectory) {
                setExpandedDirs(prev => ({
                  ...prev,
                  [node.path]: !prev[node.path]
                }));
              } else if (node.file) {
                setSelectedFilePath(node.file.path);
                setMobileView("editor");
              }
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              e.stopPropagation();
              const cleanPath = node.isDirectory ? node.path.substring(4) : node.path;
              setContextMenu({
                x: e.clientX,
                y: e.clientY,
                nodePath: node.path,
                isDirectory: node.isDirectory,
                cleanPath,
                nodeName: node.name
              });
            }}
            className={`w-full flex items-center gap-1.5 py-1.5 px-2 rounded-xl text-left text-xs font-mono transition-all cursor-pointer ${
              !node.isDirectory && (node.path === selectedFilePath || (!selectedFilePath && node.file?.path === files[0]?.path))
                ? "bg-gray-900 text-white font-semibold shadow-xs"
                : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
            }`}
          >
            {node.isDirectory ? (
              <>
                {isExpanded ? (
                  <ChevronDown className="h-3 w-3 text-gray-400 shrink-0" />
                ) : (
                  <ChevronRight className="h-3 w-3 text-gray-400 shrink-0" />
                )}
                {isExpanded ? (
                  <FolderOpen className="h-3.5 w-3.5 text-indigo-400 shrink-0 fill-indigo-50/30" />
                ) : (
                  <Folder className="h-3.5 w-3.5 text-indigo-400 shrink-0 fill-indigo-50/10" />
                )}
                <span className="truncate text-gray-700 font-medium">{node.name}</span>
              </>
            ) : (
              <>
                <span className="w-3" /> {/* Empty spacer for chevron alignment */}
                <FileText className={`h-3.5 w-3.5 shrink-0 ${
                  node.path === selectedFilePath || (!selectedFilePath && node.file?.path === files[0]?.path)
                    ? "text-amber-400"
                    : "text-gray-400"
                }`} />
                <span className="truncate">{node.name}</span>
              </>
            )}
          </button>
        )}

        {(node.path === "" || (node.isDirectory && isExpanded)) && sortedChildren.length > 0 && (
          <div className="relative space-y-1" style={{ marginLeft: node.path ? "10px" : "0" }}>
            {/* Elegant vertical alignment guidelines to showcase depth hierarchy */}
            {node.path && (
              <div className="absolute left-1.5 top-0 bottom-2 w-px bg-gray-200/50 pointer-events-none" />
            )}
            <div className={node.path ? "pl-3.5" : ""}>
              {sortedChildren.map(child => renderNode(child, node.path ? depth + 1 : depth))}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div id="code-view-container" className="flex flex-col md:flex-row flex-1 h-full min-h-[500px] border border-gray-100 rounded-3xl bg-white overflow-hidden shadow-xs">
      
      {/* File Tree Left Rail - Hidden on mobile if viewing editor */}
      <div className={`w-full md:w-64 border-r border-gray-50 bg-gray-50/50 p-4 flex flex-col h-full ${
        mobileView === "editor" ? "hidden md:flex" : "flex"
      }`}>
        <div className="flex items-center justify-between pb-4 border-b border-gray-150 mb-3 shrink-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <HardDrive className="h-4 w-4 text-gray-500 shrink-0" />
            <span className="text-[10px] font-bold tracking-wider uppercase text-gray-500 font-mono truncate">Workspace Storage</span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <button
              onClick={() => openModal("create_file", "", "", false)}
              className="p-1 hover:bg-gray-200 text-gray-500 hover:text-gray-900 rounded-md transition-colors cursor-pointer"
              title="Create File at Root"
            >
              <FilePlus className="h-3.5 w-3.5" />
            </button>
            <button
              onClick={() => openModal("create_folder", "", "", true)}
              className="p-1 hover:bg-gray-200 text-gray-500 hover:text-gray-900 rounded-md transition-colors cursor-pointer"
              title="Create Folder at Root"
            >
              <FolderPlus className="h-3.5 w-3.5" />
            </button>
            {/* Mobile view only helper */}
            <span className="md:hidden text-[9px] bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded-full font-bold ml-1">Explorer</span>
          </div>
        </div>

        {files.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-center px-4">
            <Folder className="h-8 w-8 text-gray-300 stroke-1 mb-2" />
            <p className="text-[11px] text-gray-400 font-mono">No synthesized code files found in local storage yet.</p>
          </div>
        ) : (
          <div className="space-y-1 overflow-y-auto flex-1 max-h-[300px] md:max-h-none scrollbar-thin pr-1">
            {renderNode(tree)}
          </div>
        )}
      </div>

      {/* Code Editor Right Container - Hidden on mobile if viewing tree */}
      <div className={`flex-1 flex flex-col h-full bg-gray-950 ${
        mobileView === "tree" ? "hidden md:flex" : "flex"
      }`}>
        {selectedFile ? (
          <>
            {/* Editor Toolbar */}
            <div className="flex items-center justify-between px-4 md:px-5 py-3 border-b border-gray-900 bg-gray-920 text-gray-300 font-mono text-[11px]">
              <div className="flex items-center gap-2 min-w-0">
                {/* Back to tree button for mobile screens */}
                <button
                  id="btn-editor-back-to-tree"
                  onClick={() => setMobileView("tree")}
                  className="md:hidden p-1 bg-gray-850 hover:bg-gray-800 text-gray-300 rounded-lg mr-1 flex items-center justify-center shrink-0"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
                
                <Code className="h-4 w-4 text-amber-400 shrink-0" />
                <span className="text-gray-200 font-semibold truncate text-[10px] sm:text-xs" title={selectedFile.path}>{selectedFile.path.split("/").pop()}</span>
                <span className="text-[8px] sm:text-[9px] bg-gray-800 text-gray-400 px-1.5 py-0.5 rounded-sm uppercase shrink-0">{selectedFile.language}</span>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {saveStatus === "unsaved" && (
                  <span className="text-amber-400 flex items-center gap-1 text-[9px] sm:text-[10px] font-mono mr-1 animate-pulse">
                    <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-ping mr-1" /> Unsaved draft
                  </span>
                )}
                {saveStatus === "saving" && (
                  <span className="text-sky-400 flex items-center gap-1 text-[9px] sm:text-[10px] font-mono mr-1">
                    <svg className="animate-spin h-3 w-3 text-sky-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Saving...
                  </span>
                )}
                {saveStatus === "saved" && (
                  <span className="text-emerald-400 flex items-center gap-1 text-[9px] sm:text-[10px] font-mono mr-1">
                    <Check className="h-3.5 w-3.5 text-emerald-400" /> Saved
                  </span>
                )}
                
                {isEditing ? (
                  <>
                    <button
                      id="btn-editor-cancel"
                      onClick={() => {
                        setEditorContent(selectedFile.content);
                        setIsEditing(false);
                        setSaveStatus("idle");
                      }}
                      className="px-2 py-1 text-gray-400 hover:text-gray-200 text-[9px] sm:text-[10px] uppercase font-bold"
                    >
                      Cancel
                    </button>
                    <button
                      id="btn-editor-save"
                      onClick={handleSave}
                      className="bg-emerald-600 text-white hover:bg-emerald-500 px-2.5 py-1 rounded-md flex items-center gap-1 text-[9px] sm:text-[10px] font-bold shadow-sm"
                    >
                      <Save className="h-3 w-3" /> Save Now
                    </button>
                  </>
                ) : (
                  <button
                    id="btn-editor-edit"
                    onClick={() => setIsEditing(true)}
                    className="bg-gray-800 text-gray-200 hover:bg-gray-700 px-2.5 py-1 rounded-md flex items-center gap-1.5 text-[9px] sm:text-[10px] font-bold"
                  >
                    <Edit3 className="h-3 w-3" /> Mod File
                  </button>
                )}
              </div>
            </div>

            {/* Editor Body */}
            <div className="flex-1 relative flex overflow-hidden min-h-[350px]">
              {/* Line numbers mock column */}
              <div className="bg-gray-920 text-gray-600 px-2 md:px-3.5 py-4 select-none font-mono text-[10px] md:text-xs text-right border-r border-gray-900 space-y-[4px]">
                {Array.from({ length: Math.max(15, editorContent.split("\n").length) }).map((_, i) => (
                  <div key={i}>{i + 1}</div>
                ))}
              </div>
              
              {isEditing ? (
                <textarea
                  id="textarea-code-editor"
                  value={editorContent}
                  onChange={(e) => setEditorContent(e.target.value)}
                  className="flex-1 w-full h-full bg-transparent text-gray-100 p-4 font-mono text-[11px] md:text-xs focus:outline-none resize-none leading-relaxed space-y-[4px]"
                  spellCheck="false"
                />
              ) : (
                <pre className="flex-1 p-4 overflow-y-auto leading-relaxed text-[11px] md:text-xs font-mono text-gray-200 select-text scrollbar-thin">
                  <code>{selectedFile.content}</code>
                </pre>
              )}
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center flex-1 text-center p-8 text-gray-500 font-mono">
            {/* Mobile Back button if empty and in editor state */}
            <button onClick={() => setMobileView("tree")} className="md:hidden mb-4 bg-gray-800 px-3 py-1.5 rounded-xl text-xs text-gray-300">Show Explorer</button>
            <Code className="h-12 w-12 text-gray-700 stroke-1 mb-3 animate-pulse" />
            <h4 className="text-sm font-bold text-gray-400">No File Loaded</h4>
            <p className="text-[11px] max-w-xs mt-1 text-gray-600">
              When Sovereign Agent begins building, the synthesized code files will appear in this workspace workspace.
            </p>
          </div>
        )}
      </div>

      {/* Floating Right-Click Context Menu */}
      {contextMenu && (
        <div
          className="fixed bg-white border border-gray-200 shadow-xl rounded-2xl py-1.5 w-48 z-50 font-sans text-xs text-gray-700 animate-in fade-in zoom-in-95 duration-100"
          style={{ top: contextMenu.y, left: contextMenu.x }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.isDirectory ? (
            <>
              <div className="px-3 py-1.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider truncate font-mono border-b border-gray-50 mb-1">
                Folder: {contextMenu.nodeName}
              </div>
              <button
                onClick={() => {
                  openModal("create_file", contextMenu.nodePath, contextMenu.cleanPath, true);
                  setContextMenu(null);
                }}
                className="w-full text-left px-3 py-2 hover:bg-gray-50 text-gray-700 font-medium flex items-center gap-2 cursor-pointer"
              >
                <FilePlus className="h-3.5 w-3.5 text-gray-400" />
                <span>New File...</span>
              </button>
              <button
                onClick={() => {
                  openModal("create_folder", contextMenu.nodePath, contextMenu.cleanPath, true);
                  setContextMenu(null);
                }}
                className="w-full text-left px-3 py-2 hover:bg-gray-50 text-gray-700 font-medium flex items-center gap-2 cursor-pointer"
              >
                <FolderPlus className="h-3.5 w-3.5 text-gray-400" />
                <span>New Folder...</span>
              </button>
              <div className="border-t border-gray-100 my-1" />
              <button
                onClick={() => {
                  openModal("rename", contextMenu.nodePath, contextMenu.cleanPath, true);
                  setContextMenu(null);
                }}
                className="w-full text-left px-3 py-2 hover:bg-gray-50 text-gray-700 font-medium flex items-center gap-2 cursor-pointer"
              >
                <Edit3 className="h-3.5 w-3.5 text-gray-400" />
                <span>Rename Folder...</span>
              </button>
              <button
                onClick={() => {
                  openModal("delete", contextMenu.nodePath, contextMenu.cleanPath, true);
                  setContextMenu(null);
                }}
                className="w-full text-left px-3 py-2 hover:bg-gray-50 text-rose-600 hover:text-rose-700 hover:bg-rose-50 font-medium flex items-center gap-2 cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5 text-rose-400" />
                <span>Delete Folder...</span>
              </button>
            </>
          ) : (
            <>
              <div className="px-3 py-1.5 text-[10px] font-bold text-gray-400 uppercase tracking-wider truncate font-mono border-b border-gray-50 mb-1">
                File: {contextMenu.nodeName}
              </div>
              <button
                onClick={() => {
                  openModal("rename", contextMenu.nodePath, contextMenu.cleanPath, false);
                  setContextMenu(null);
                }}
                className="w-full text-left px-3 py-2 hover:bg-gray-50 text-gray-700 font-medium flex items-center gap-2 cursor-pointer"
              >
                <Edit3 className="h-3.5 w-3.5 text-gray-400" />
                <span>Rename File...</span>
              </button>
              <button
                onClick={() => {
                  openModal("delete", contextMenu.nodePath, contextMenu.cleanPath, false);
                  setContextMenu(null);
                }}
                className="w-full text-left px-3 py-2 hover:bg-gray-50 text-rose-600 hover:text-rose-700 hover:bg-rose-50 font-medium flex items-center gap-2 cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5 text-rose-400" />
                <span>Delete File...</span>
              </button>
            </>
          )}
        </div>
      )}

      {/* Action Modals */}
      {modal && (
        <div className="fixed inset-0 bg-gray-900/40 backdrop-blur-xs z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl overflow-hidden border border-gray-100 flex flex-col p-6 space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-200">
            <div className="flex items-center justify-between pb-1">
              <h3 className="text-sm font-bold text-gray-900 flex items-center gap-2">
                {modal.type === "create_file" && (
                  <>
                    <FilePlus className="h-4 w-4 text-indigo-500" />
                    <span>Create New File</span>
                  </>
                )}
                {modal.type === "create_folder" && (
                  <>
                    <FolderPlus className="h-4 w-4 text-indigo-500" />
                    <span>Create New Folder</span>
                  </>
                )}
                {modal.type === "rename" && (
                  <>
                    <Edit3 className="h-4 w-4 text-amber-500" />
                    <span>Rename {modal.isDirectory ? "Folder" : "File"}</span>
                  </>
                )}
                {modal.type === "delete" && (
                  <>
                    <AlertCircle className="h-4 w-4 text-rose-500" />
                    <span className="text-rose-600">Delete {modal.isDirectory ? "Folder" : "File"}?</span>
                  </>
                )}
              </h3>
              <button
                onClick={() => setModal(null)}
                className="text-gray-400 hover:text-gray-600 p-1 rounded-full hover:bg-gray-50 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {modal.type === "create_file" && (
              <div className="space-y-3">
                <p className="text-xs text-gray-500 leading-relaxed">
                  Creating file relative to: <code className="bg-gray-100 px-1 py-0.5 rounded text-[11px] font-mono font-semibold">{modal.cleanPath || "root"}</code>
                </p>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">File Name / Path</label>
                  <input
                    type="text"
                    value={modal.newValue}
                    onChange={(e) => setModal({ ...modal, newValue: e.target.value })}
                    placeholder="e.g. utils.ts"
                    className="w-full bg-gray-50 hover:bg-gray-100/50 focus:bg-white border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 rounded-xl px-3 py-2 text-xs font-mono outline-none transition-all"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleExecuteFileOp();
                    }}
                  />
                </div>
              </div>
            )}

            {modal.type === "create_folder" && (
              <div className="space-y-3">
                <p className="text-xs text-gray-500 leading-relaxed">
                  Creating folder relative to: <code className="bg-gray-100 px-1 py-0.5 rounded text-[11px] font-mono font-semibold">{modal.cleanPath || "root"}</code>
                </p>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">Folder Name</label>
                  <input
                    type="text"
                    value={modal.newValue}
                    onChange={(e) => setModal({ ...modal, newValue: e.target.value })}
                    placeholder="e.g. components"
                    className="w-full bg-gray-50 hover:bg-gray-100/50 focus:bg-white border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 rounded-xl px-3 py-2 text-xs font-mono outline-none transition-all"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleExecuteFileOp();
                    }}
                  />
                </div>
              </div>
            )}

            {modal.type === "rename" && (
              <div className="space-y-3">
                <p className="text-xs text-gray-500 leading-relaxed">
                  Renaming path: <code className="bg-gray-100 px-1 py-0.5 rounded text-[11px] font-mono font-semibold">{modal.cleanPath}</code>
                </p>
                <div className="space-y-1">
                  <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wide">New Path</label>
                  <input
                    type="text"
                    value={modal.newValue}
                    onChange={(e) => setModal({ ...modal, newValue: e.target.value })}
                    placeholder="e.g. src/utils/helper.ts"
                    className="w-full bg-gray-50 hover:bg-gray-100/50 focus:bg-white border border-gray-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 rounded-xl px-3 py-2 text-xs font-mono outline-none transition-all"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleExecuteFileOp();
                    }}
                  />
                </div>
              </div>
            )}

            {modal.type === "delete" && (
              <div className="space-y-3">
                <p className="text-xs text-gray-600 leading-relaxed font-medium">
                  Are you sure you want to permanently delete <code className="bg-rose-50 text-rose-600 px-1.5 py-0.5 rounded text-[11px] font-mono font-semibold">{modal.cleanPath}</code>?
                </p>
                {modal.isDirectory && (
                  <p className="text-[11px] text-rose-500 leading-normal bg-rose-50/50 border border-rose-100 rounded-xl p-3 flex gap-2">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span><strong>Warning:</strong> This is a directory. Deleting this folder will permanently erase all files and subfolders contained within it. This action cannot be undone!</span>
                  </p>
                )}
              </div>
            )}

            <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
              <button
                onClick={() => setModal(null)}
                className="px-4 py-2 text-gray-500 hover:bg-gray-50 hover:text-gray-700 rounded-xl text-xs font-medium cursor-pointer transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleExecuteFileOp}
                className={`px-4 py-2 rounded-xl text-xs font-semibold cursor-pointer text-white transition-all ${
                  modal.type === "delete"
                    ? "bg-rose-600 hover:bg-rose-500 shadow-sm shadow-rose-100"
                    : "bg-indigo-600 hover:bg-indigo-500 shadow-sm shadow-indigo-100"
                }`}
              >
                {modal.type === "delete" ? "Delete Permanently" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
