"use client";

import React from "react";
import { type WidgetNode } from "../../lib/agents/engine";
import { 
  Anchor, 
  Settings, 
  Terminal, 
  Layers, 
  Eye, 
  Code, 
  Cpu, 
  RefreshCw, 
  Copy, 
  Download, 
  Check, 
  Database,
  ArrowRight,
  ShieldAlert,
  FileText
} from "lucide-react";

interface AgentLog {
  agentName: string;
  message: string;
  timestamp: string;
  type: "info" | "success" | "warning" | "error" | "collab";
}

interface PipelineMemory {
  systemTitle: string;
  theme: string;
  lastFeedback: string[];
  customAttributes: Record<string, string>;
  lastWidgetTree?: WidgetNode[];
  lastGeneratedCode?: string;
}

export default function Home() {
  // Hydration and script-loading state
  const [mounted, setMounted] = React.useState(false);
  const [babelLoaded, setBabelLoaded] = React.useState(false);

  // Settings & Keys (can override server environment key if entered in UI)
  const [apiKey, setApiKey] = React.useState<string>(() => {
    if (typeof window !== "undefined") {
      return localStorage.getItem("groq_api_key") || "";
    }
    return "";
  });
  const [showKeyInput, setShowKeyInput] = React.useState(false);

  // Form inputs
  const [prdText, setPrdText] = React.useState("");
  const [feedbackText, setFeedbackText] = React.useState("");

  // Pipeline Execution State
  const [isRunning, setIsRunning] = React.useState(false);
  const [logs, setLogs] = React.useState<AgentLog[]>([]);
  const [widgetTree, setWidgetTree] = React.useState<WidgetNode[]>([]);
  const [generatedCode, setGeneratedCode] = React.useState("");
  const [memory, setMemory] = React.useState<PipelineMemory>({
    systemTitle: "Pending Specs...",
    theme: "slate",
    lastFeedback: [],
    customAttributes: {}
  });

  // UI Tabs
  const [activeTab, setActiveTab] = React.useState<"preview" | "hierarchy" | "code">("preview");
  const [previewError, setPreviewError] = React.useState<string | null>(null);
  const [copySuccess, setCopySuccess] = React.useState(false);

  // Auto-scroll logs container reference
  const logsEndRef = React.useRef<HTMLDivElement>(null);

  // Load Babel Standalone dynamically on mount
  React.useEffect(() => {
    setMounted(true);

    if ((window as any).Babel) {
      setBabelLoaded(true);
      return;
    }

    const script = document.createElement("script");
    script.src = "https://cdn.jsdelivr.net/npm/@babel/standalone@7.24.4/babel.min.js";
    script.async = true;
    script.onload = () => {
      setBabelLoaded(true);
    };
    script.onerror = () => {
      console.error("Failed to load Babel Standalone compiler.");
    };
    document.body.appendChild(script);

    return () => {
      if (document.body.contains(script)) {
        document.body.removeChild(script);
      }
    };
  }, []);

  // Save key to local storage
  const handleSaveKey = (val: string) => {
    setApiKey(val);
    if (typeof window !== "undefined") {
      localStorage.setItem("groq_api_key", val);
    }
  };

  // Compile Code for Iframe Sandbox
  const compiledSandbox = React.useMemo(() => {
    if (!generatedCode) return { srcDoc: "", error: "No code generated yet." };

    try {
      const functionMatch = generatedCode.match(/function\s+(\w+)/);
      if (!functionMatch) {
        return { srcDoc: "", error: "No primary React functional component detected." };
      }
      const functionName = functionMatch[1];

      // Transpile using client-side Babel Standalone loaded dynamically
      const Babel = (window as any).Babel;
      if (!babelLoaded || !Babel) {
        return { srcDoc: "", error: "Babel compiler is loading from CDN. Please wait..." };
      }

      const transpiled = Babel.transform(generatedCode, {
        presets: ["react"]
      }).code;

      const doc = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <script src="https://unpkg.com/react@18/umd/react.production.min.js" crossorigin></script>
          <script src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js" crossorigin></script>
          <script src="https://cdn.tailwindcss.com"></script>
          <style>
            body {
              background-color: #0c0d12;
              color: #cbd5e1;
              margin: 0;
              padding: 24px;
              font-family: sans-serif;
              min-height: 100vh;
              overflow-x: hidden;
            }
            body::-webkit-scrollbar {
              width: 6px;
              height: 6px;
            }
            body::-webkit-scrollbar-track {
              background: rgba(0,0,0,0.1);
            }
            body::-webkit-scrollbar-thumb {
              background: rgba(255,255,255,0.15);
              border-radius: 3px;
            }
          </style>
        </head>
        <body>
          <div id="root"></div>
          <script>
            window.addEventListener('error', function(e) {
              window.parent.postMessage({ type: 'PREVIEW_ERROR', message: e.message }, '*');
            });
          </script>
          <script>
            try {
              ${transpiled}

              // Mount
              ReactDOM.createRoot(document.getElementById('root')).render(
                React.createElement(${functionName})
              );
            } catch(err) {
              window.parent.postMessage({ type: 'PREVIEW_ERROR', message: err.message }, '*');
            }
          </script>
        </body>
        </html>
      `;

      return { srcDoc: doc, error: null };

    } catch (err: any) {
      return { srcDoc: "", error: err.message };
    }
  }, [generatedCode]);

  // Listen to errors from Iframe runtime
  React.useEffect(() => {
    const handleIframeMessage = (event: MessageEvent) => {
      if (event.data && event.data.type === "PREVIEW_ERROR") {
        setPreviewError(event.data.message);
      }
    };
    window.addEventListener("message", handleIframeMessage);
    return () => window.removeEventListener("message", handleIframeMessage);
  }, []);

  // Run NextJS backend API pipeline
  const executePipeline = async (isIteration = false) => {
    setIsRunning(true);
    setPreviewError(null);
    if (!isIteration) {
      setLogs([]);
    }

    try {
      // Local client-side loader log
      setLogs(prev => [
        ...prev,
        {
          agentName: "Client Gateway",
          message: "Sending request to Next.js agent pipeline API endpoint...",
          timestamp: new Date().toLocaleTimeString(),
          type: "info"
        }
      ]);

      const response = await fetch("/api/agent", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          prdText,
          feedbackText: isIteration ? feedbackText : "",
          apiKey, // user-supplied override or empty (which falls back to server env variable)
          memory
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Server API returned error (${response.status}): ${errorText}`);
      }

      const data = await response.json(); // { widgetTree, generatedCode, logs, memory }
      
      if (data.error) {
        throw new Error(data.error);
      }

      // Sequentially print/play logs to simulate real-time agent dialogue
      let logIndex = 0;
      const playLogs = () => {
        if (logIndex < data.logs.length) {
          setLogs(prev => [...prev, data.logs[logIndex]]);
          logIndex++;
          setTimeout(playLogs, 350); // 350ms typewriter-like delay between agent updates
        } else {
          // Finish playing
          setWidgetTree(data.widgetTree);
          setGeneratedCode(data.generatedCode);
          setMemory(data.memory);
          setIsRunning(false);
          if (isIteration) {
            setFeedbackText(""); // clear input
          }
        }
      };
      playLogs();

    } catch (err: any) {
      setLogs(prev => [
        ...prev,
        {
          agentName: "Client Gateway",
          message: `Pipeline interaction failed: ${err.message}`,
          timestamp: new Date().toLocaleTimeString(),
          type: "error"
        }
      ]);
      setIsRunning(false);
    }
  };

  // Copy Code to Clipboard
  const handleCopyCode = () => {
    navigator.clipboard.writeText(generatedCode);
    setCopySuccess(true);
    setTimeout(() => setCopySuccess(false), 2000);
  };

  // Download Code File
  const handleDownloadCode = () => {
    const blob = new Blob([generatedCode], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `vessel-dashboard.tsx`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Auto-scroll logs
  React.useEffect(() => {
    if (logsEndRef.current) {
      logsEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [logs]);

  if (!mounted) {
    return (
      <div className="min-h-screen bg-[#07080b] flex flex-col items-center justify-center font-sans text-slate-400">
        <Anchor className="w-8 h-8 animate-spin text-blue-500 mb-4" />
        <p className="text-xs font-semibold tracking-wider uppercase">Loading BridgeView Console...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen text-slate-100 flex flex-col font-sans select-none antialiased">
      
      {/* 1. Header Bar */}
      <header className="glass border-b border-white/5 py-4 px-6 flex items-center justify-between sticky top-0 z-50">
        <div className="flex items-center gap-3">
          <div className="bg-gradient-to-tr from-blue-600 to-cyan-400 p-2 rounded-xl text-white shadow-lg glow-blue-subtle">
            <Anchor className="w-6 h-6 animate-pulse" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white font-outfit flex items-center gap-2">
              BridgeView AI <span className="text-[10px] bg-blue-500/10 text-blue-400 border border-blue-500/20 px-2 py-0.5 rounded-full font-sans uppercase">Next.js App</span>
            </h1>
            <p className="text-[10px] text-slate-400">Spec-to-Code Full-Stack Platform</p>
          </div>
        </div>

        {/* Global telemetry variables */}
        <div className="hidden lg:flex items-center gap-6 text-xs bg-black/40 border border-white/5 px-4 py-2 rounded-xl">
          <div className="flex items-center gap-2">
            <Database className="w-3.5 h-3.5 text-blue-400" />
            <span className="text-slate-500">System Context:</span>
            <span className="font-bold text-white font-mono">{memory.systemTitle}</span>
          </div>
          <div className="w-px h-4 bg-white/15"></div>
          <div className="flex items-center gap-2">
            <span className="text-slate-500">Theme Accent:</span>
            <span className={`w-3 h-3 rounded-full border border-white/10 ${
              memory.theme === 'emerald' ? 'bg-emerald-500 shadow-[0_0_10px_#10b981]' :
              memory.theme === 'indigo' ? 'bg-indigo-500 shadow-[0_0_10px_#6366f1]' :
              memory.theme === 'purple' ? 'bg-purple-500 shadow-[0_0_10px_#a855f7]' :
              memory.theme === 'amber' ? 'bg-amber-500 shadow-[0_0_10px_#f59e0b]' :
              memory.theme === 'rose' ? 'bg-rose-500 shadow-[0_0_10px_#f43f5e]' :
              memory.theme === 'teal' ? 'bg-teal-500 shadow-[0_0_10px_#14b8a6]' :
              memory.theme === 'blue' ? 'bg-blue-500 shadow-[0_0_10px_#3b82f6]' :
              'bg-slate-500 shadow-[0_0_10px_#64748b]'
            }`}></span>
            <span className="font-bold text-slate-300 capitalize">{memory.theme || 'default'}</span>
          </div>
          <div className="w-px h-4 bg-white/15"></div>
          <div className="flex items-center gap-2">
            <span className="text-slate-500">API Gateway Status:</span>
            <span className={`w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_8px_#10b981]`}></span>
            <span className="font-bold text-emerald-400">Next.js Backend Active</span>
          </div>
        </div>

        {/* Settings button */}
        <button 
          onClick={() => setShowKeyInput(!showKeyInput)}
          className={`p-2 rounded-lg border transition-all ${showKeyInput ? 'bg-blue-600 border-blue-500 text-white' : 'bg-slate-900 border-white/10 text-slate-400 hover:text-white'}`}
        >
          <Settings className="w-4 h-4" />
        </button>
      </header>

      {/* API Key Modal Drawer */}
      {showKeyInput && (
        <div className="bg-slate-900/95 border-b border-blue-900/30 px-6 py-4 flex flex-col md:flex-row justify-between items-center gap-4 transition-all duration-300">
          <div className="flex-1 max-w-lg">
            <h3 className="text-sm font-semibold text-white flex items-center gap-2">
              <Cpu className="w-4 h-4 text-blue-400" /> Groq API Client-Side Override
            </h3>
            <p className="text-xs text-slate-400 mt-1">
              By default, Next.js uses the secret <code>GROQ_API_KEY</code> defined in the server-side <code>.env</code> file. To override it, paste an API key here.
            </p>
          </div>
          <div className="flex items-center gap-2 w-full md:w-auto">
            <input 
              type="password"
              placeholder="Override Groq API Key (gsk_...)"
              value={apiKey}
              onChange={(e) => handleSaveKey(e.target.value)}
              className="bg-black/50 border border-white/15 rounded-lg px-3 py-2 text-xs text-white outline-none focus:border-blue-500 w-full md:w-80 font-mono"
            />
            {apiKey && (
              <button 
                onClick={() => handleSaveKey("")}
                className="bg-red-950/40 hover:bg-red-950 text-red-400 border border-red-900/30 text-xs px-3 py-2 rounded-lg"
              >
                Clear Override
              </button>
            )}
            <button 
              onClick={() => setShowKeyInput(false)}
              className="bg-slate-800 hover:bg-slate-700 text-xs px-4 py-2 rounded-lg"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {/* 2. Main Workstation Panel */}
      <main className="flex-1 grid grid-cols-1 xl:grid-cols-12 gap-6 p-6 h-[calc(100vh-68px)] overflow-y-auto xl:overflow-hidden">
        
        {/* Left Column: Requirements and Agent Control (xl:col-span-5) */}
        <div className="xl:col-span-5 flex flex-col gap-6 xl:h-full xl:overflow-y-auto no-scrollbar">
          
          {/* PRD Input Card */}
          <div className="glass rounded-2xl p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="w-4.5 h-4.5 text-blue-400" />
                <h2 className="text-sm font-semibold text-white uppercase tracking-wider">Product Requirement (PRD)</h2>
              </div>
            </div>

            <textarea 
              rows={8}
              value={prdText}
              onChange={(e) => setPrdText(e.target.value)}
              className="w-full bg-black/40 border border-white/5 rounded-xl p-3.5 text-xs font-mono text-slate-300 outline-none focus:border-blue-500/40 resize-none h-44 scrollbar-thin"
              placeholder="Paste your product requirements doc here..."
            />

            <button 
              onClick={() => executePipeline(false)}
              disabled={isRunning || !prdText}
              className="w-full bg-gradient-to-r from-blue-600 to-cyan-500 hover:from-blue-500 hover:to-cyan-400 disabled:from-slate-800 disabled:to-slate-800 disabled:text-slate-500 text-white font-bold py-2.5 rounded-xl flex items-center justify-center gap-2 shadow-lg transition-all duration-200"
            >
              <RefreshCw className={`w-4 h-4 ${isRunning ? 'animate-spin' : ''}`} />
              {isRunning ? "Pipeline Running..." : "Execute 2-Agent Pipeline"}
            </button>
          </div>

          {/* Pipeline Memory State Card */}
          <div className="glass rounded-2xl p-5">
            <h3 className="text-xs font-semibold text-white uppercase tracking-wider mb-3 flex items-center gap-2">
              <Database className="w-3.5 h-3.5 text-blue-400" /> Pipeline State (Short-Term Memory)
            </h3>
            
            <div className="grid grid-cols-2 gap-3 text-xs mb-4">
              <div className="bg-black/30 p-2.5 rounded-xl border border-white/5">
                <span className="text-[10px] text-slate-500 block">System Title Target</span>
                <span className="font-bold text-white font-mono">{memory.systemTitle}</span>
              </div>
              <div className="bg-black/30 p-2.5 rounded-xl border border-white/5">
                <span className="text-[10px] text-slate-500 block">UI Theme Accent</span>
                <span className="font-bold text-white capitalize">{memory.theme} color</span>
              </div>
            </div>

            <div className="bg-black/30 p-3 rounded-xl border border-white/5 text-xs">
              <span className="text-[10px] text-slate-500 block mb-1">Feedback Iteration Logs</span>
              {memory.lastFeedback.length === 0 ? (
                <p className="text-slate-500 italic text-[11px]">No feedback submitted in this session yet.</p>
              ) : (
                <ul className="space-y-1 max-h-24 overflow-y-auto no-scrollbar font-mono text-[10px] text-blue-300">
                  {memory.lastFeedback.map((f, i) => (
                    <li key={i} className="flex gap-2 items-start">
                      <span className="text-slate-600">[{i+1}]</span>
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Feedback loop Input */}
          <div className="glass rounded-2xl p-5 flex flex-col gap-3">
            <h3 className="text-xs font-semibold text-white uppercase tracking-wider flex items-center gap-2">
              <Cpu className="w-3.5 h-3.5 text-cyan-400" /> Iterate Design (Memory Loop)
            </h3>
            <p className="text-[11px] text-slate-400">
              Instruct the backend agents to modify the design (e.g. <i>"Rename the vessel to MV Alpha and change the layout colors to green"</i>).
            </p>
            <div className="flex gap-2">
              <input 
                type="text"
                placeholder="Type design feedback to iterate..."
                value={feedbackText}
                onChange={(e) => setFeedbackText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && feedbackText && !isRunning) {
                    executePipeline(true);
                  }
                }}
                disabled={isRunning}
                className="flex-1 bg-black/40 border border-white/5 rounded-xl px-3 py-2 text-xs text-white outline-none focus:border-cyan-500/40"
              />
              <button
                onClick={() => executePipeline(true)}
                disabled={isRunning || !feedbackText}
                className="bg-cyan-950 hover:bg-cyan-900 disabled:bg-slate-800 disabled:text-slate-500 text-cyan-400 border border-cyan-800/40 font-bold px-4 rounded-xl text-xs flex items-center gap-1.5 transition-all"
              >
                Apply <ArrowRight className="w-3 h-3" />
              </button>
            </div>
          </div>

          {/* Agent Activity Console Logs */}
          <div className="glass rounded-2xl p-5 flex-1 flex flex-col gap-3 min-h-[250px] xl:min-h-0">
            <div className="flex items-center justify-between border-b border-white/5 pb-2">
              <h3 className="text-xs font-semibold text-white uppercase tracking-wider flex items-center gap-2">
                <Terminal className="w-3.5 h-3.5 text-blue-400" /> Pipeline Console Activity
              </h3>
              <span className="text-[9px] text-slate-500 font-mono">Next.js API logs</span>
            </div>
            
            <div className="bg-black/50 rounded-xl p-3.5 font-mono text-[11px] flex-1 overflow-y-auto max-h-[300px] xl:max-h-none h-60 xl:h-auto no-scrollbar space-y-2.5">
              {logs.length === 0 ? (
                <div className="text-slate-600 italic text-center py-12">
                  Console idle. Run the pipeline to display real-time collaboration logs between Spec Analyzer and Component Builder.
                </div>
              ) : (
                logs.map((log, index) => {
                  if (!log) return null;
                  return (
                    <div key={index} className="space-y-0.5 animate-fadeIn">
                      <div className="flex items-center justify-between text-[9px]">
                        <span className={`font-bold uppercase ${
                          log.agentName?.includes("Analyzer") ? "text-blue-400" :
                          log.agentName?.includes("Builder") ? "text-cyan-400" :
                          log.agentName?.includes("Tool") ? "text-amber-400" : 
                          log.agentName?.includes("Client") ? "text-slate-400 font-bold" : "text-slate-500"
                        }`}>
                          [{log.agentName}]
                        </span>
                        <span className="text-slate-600">{log.timestamp}</span>
                      </div>
                      <p className={`leading-relaxed ${
                        log.type === "success" ? "text-emerald-400" :
                        log.type === "warning" ? "text-amber-400" :
                        log.type === "error" ? "text-red-400" :
                        log.type === "collab" ? "text-purple-400 font-semibold" : "text-slate-300"
                      }`}>
                        {log.message}
                      </p>
                    </div>
                  );
                })
              )}
              <div ref={logsEndRef} />
            </div>
          </div>

        </div>

        {/* Right Column: Output Tabs & Live View (xl:col-span-7) */}
        <div className="xl:col-span-7 flex flex-col gap-4 xl:h-full">
          
          {/* Tab Navigation header */}
          <div className="flex justify-between items-center bg-slate-950/60 p-1.5 rounded-2xl border border-white/5 shrink-0">
            <div className="flex gap-1.5">
              {[
                { id: "preview", label: "Live Interactive Preview", icon: Eye },
                { id: "hierarchy", label: "Component Tree Layout", icon: Layers },
                { id: "code", label: "Production React Code", icon: Code }
              ].map(tab => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id as any)}
                    className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold transition-all duration-150 ${
                      activeTab === tab.id 
                        ? 'bg-blue-600 text-white shadow-lg glow-blue-subtle' 
                        : 'text-slate-400 hover:text-slate-200 hover:bg-white/5'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {tab.label}
                  </button>
                );
              })}
            </div>

            {/* Actions for Code View */}
            {activeTab === "code" && (
              <div className="flex gap-2 px-2">
                <button
                  onClick={handleCopyCode}
                  className="bg-slate-900 border border-white/10 p-1.5 rounded-lg text-slate-400 hover:text-white flex items-center gap-1.5 text-xs hover:border-slate-700 transition-all"
                  title="Copy to clipboard"
                >
                  {copySuccess ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copySuccess ? "Copied" : "Copy"}</span>
                </button>
                <button
                  onClick={handleDownloadCode}
                  className="bg-slate-900 border border-white/10 p-1.5 rounded-lg text-slate-400 hover:text-white flex items-center gap-1.5 text-xs hover:border-slate-700 transition-all"
                  title="Export Code to file"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Export</span>
                </button>
              </div>
            )}
          </div>

          {/* Tab View Container */}
          <div className="flex-1 bg-slate-950/40 rounded-2xl border border-white/5 overflow-hidden flex flex-col relative h-[500px] xl:h-auto">
            
            {/* LIVE PREVIEW COMPONENT TAB */}
            {activeTab === "preview" && (
              <div className="flex-1 flex flex-col h-full overflow-hidden">
                {previewError && (
                  <div className="bg-red-950/60 border-b border-red-900/30 p-3.5 text-xs text-red-200 flex items-start gap-2.5 shrink-0 animate-pulse">
                    <ShieldAlert className="w-4.5 h-4.5 text-red-400 shrink-0 mt-0.5" />
                    <div>
                      <span className="font-bold">Sandbox Compiler Error:</span>
                      <p className="font-mono mt-0.5 text-[11px] leading-relaxed">{previewError}</p>
                    </div>
                  </div>
                )}

                {!generatedCode ? (
                  <div className="flex-1 flex flex-col items-center justify-center p-12 text-center text-slate-500">
                    <Code className="w-12 h-12 text-blue-500/50 mb-3 animate-pulse" />
                    <h4 className="text-white font-semibold mb-1">Awaiting Generation</h4>
                    <p className="text-xs max-w-md">Run the pipeline to generate your UI components.</p>
                  </div>
                ) : compiledSandbox.error ? (
                  <div className="flex-1 flex flex-col items-center justify-center p-12 text-center text-slate-500">
                    <ShieldAlert className="w-12 h-12 text-amber-500 mb-3" />
                    <h4 className="text-white font-semibold mb-1">Compiler Error</h4>
                    <p className="text-xs max-w-md">{compiledSandbox.error}</p>
                  </div>
                ) : (
                  <iframe 
                    title="BridgeView UI Render Sandbox"
                    srcDoc={compiledSandbox.srcDoc}
                    sandbox="allow-scripts"
                    className="w-full flex-1 border-0 bg-[#0c0d12]"
                  />
                )}
              </div>
            )}

            {/* WIDGET TREE TAB */}
            {activeTab === "hierarchy" && (
              <div className="flex-1 p-6 overflow-y-auto no-scrollbar flex flex-col">
                <div className="flex items-center gap-2 mb-6 border-b border-white/5 pb-3 shrink-0">
                  <Layers className="w-4 h-4 text-blue-400" />
                  <div>
                    <h3 className="text-xs font-semibold text-white uppercase tracking-wider">Proposed Layout Tree</h3>
                    <p className="text-[10px] text-slate-500">Layout planning output from Spec Analyzer Agent</p>
                  </div>
                </div>

                <div className="flex-1 flex flex-col justify-center max-w-xl mx-auto w-full py-4 space-y-4">
                  {widgetTree.map((node) => (
                    <div key={node.id} className="space-y-4">
                      {/* Root node */}
                      <div className="bg-[#10111a] border border-blue-900/30 rounded-xl p-4 flex justify-between items-center shadow-lg relative">
                        <div className="absolute left-6 -bottom-4 w-0.5 h-4 bg-blue-900/40"></div>
                        <div className="flex items-center gap-3">
                          <span className="w-2.5 h-2.5 bg-blue-500 rounded-full shadow-[0_0_10px_#3b82f6]"></span>
                          <div>
                            <span className="text-[9px] font-bold uppercase tracking-widest text-blue-400">{node.type}</span>
                            <h4 className="text-xs font-bold text-white mt-0.5">{node.name}</h4>
                          </div>
                        </div>
                        <p className="text-[11px] text-slate-400 max-w-sm text-right">{node.description}</p>
                      </div>

                      {/* Children nodes */}
                      {node.children && node.children.map((child, cIdx) => (
                        <div key={child.id} className="pl-8 relative flex flex-col gap-4">
                          {/* Connector lines */}
                          <div className="absolute left-4 top-0 bottom-1/2 w-4 border-l-2 border-b-2 border-blue-950/80 rounded-bl-lg"></div>
                          {cIdx < node.children!.length - 1 && (
                            <div className="absolute left-4 top-1/2 bottom-0 w-0.5 border-l-2 border-blue-950/80"></div>
                          )}

                          <div className="bg-[#121420]/60 border border-white/5 rounded-xl p-3.5 flex justify-between items-center relative hover:border-blue-900/20 transition-all duration-200">
                            <div className="flex items-center gap-3">
                              <span className="w-2 h-2 bg-cyan-500 rounded-full shadow-[0_0_8px_#06b6d4]"></span>
                              <div>
                                <span className="text-[9px] font-bold uppercase tracking-widest text-cyan-400">{child.type}</span>
                                <h5 className="text-xs font-semibold text-slate-200 mt-0.5">{child.name}</h5>
                              </div>
                            </div>
                            <p className="text-[10px] text-slate-400 max-w-xs text-right">{child.description}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* PRODUCTION REACT CODE TAB */}
            {activeTab === "code" && (
              <div className="flex-1 flex flex-col overflow-hidden h-full">
                <div className="bg-slate-900 px-4 py-2 border-b border-white/5 flex justify-between items-center shrink-0">
                  <span className="text-[10px] font-mono text-slate-400">generated-dashboard.tsx</span>
                  <span className="text-[9px] text-emerald-400 font-bold uppercase">React + Tailwind</span>
                </div>
                <div className="flex-1 overflow-auto p-4 bg-black/40 font-mono text-xs text-slate-300 leading-relaxed scrollbar-thin select-text">
                  <pre className="no-scrollbar">
                    <code>{generatedCode}</code>
                  </pre>
                </div>
              </div>
            )}

          </div>
        </div>

      </main>
    </div>
  );
}
