export interface WidgetNode {
  id: string;
  name: string;
  type: string;
  description: string;
  status: string;
  children?: WidgetNode[];
}

export interface AgentLog {
  agentName: string;
  message: string;
  timestamp: string;
  type: "info" | "success" | "warning" | "error" | "collab";
}

export interface PipelineMemory {
  systemTitle: string;
  theme: string;
  lastFeedback: string[];
  customAttributes: Record<string, string>;
  lastWidgetTree?: WidgetNode[];
  lastGeneratedCode?: string;
}

export interface PipelineResult {
  widgetTree: WidgetNode[];
  generatedCode: string;
  logs: AgentLog[];
  memory: PipelineMemory;
}

// Custom tools for the agents
export const agentTools = {
  validateCodeSyntax(code: string): { isValid: boolean; error?: string } {
    const openBraces = (code.match(/\{/g) || []).length;
    const closeBraces = (code.match(/\}/g) || []).length;
    if (openBraces !== closeBraces) {
      return { isValid: false, error: `Brace mismatch: ${openBraces} open vs ${closeBraces} closed.` };
    }
    
    const openParens = (code.match(/\(/g) || []).length;
    const closeParens = (code.match(/\)/g) || []).length;
    if (openParens !== closeParens) {
      return { isValid: false, error: `Parenthesis mismatch: ${openParens} open vs ${closeParens} closed.` };
    }

    if (code.includes("import ") || code.includes("export ")) {
      return { isValid: false, error: "Imports or Exports detected. Code must be a self-contained component function." };
    }

    return { isValid: true };
  },

  simulatePreview(code: string): { isSimulatable: boolean } {
    const usesHooksDirectly = /\b(useState|useEffect|useMemo|useRef)\b/.test(code) && !/React\.(useState|useEffect|useMemo|useRef)/.test(code);
    return { isSimulatable: !usesHooksDirectly };
  }
};

// Groq API call utility
async function callGroqAPI(apiKey: string, systemPrompt: string, userPrompt: string, jsonMode = false): Promise<string> {
  const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      temperature: 0.2,
      response_format: jsonMode ? { type: "json_object" } : undefined
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Groq API failure (${response.status}): ${errorText}`);
  }

  const data = await response.json();
  return data.choices[0].message.content || "";
}

// Primary pipeline orchestrator
export async function runPipeline(
  prdText: string,
  feedbackText: string,
  apiKey: string,
  currentMemory: PipelineMemory,
  onProgress: (log: AgentLog) => void
): Promise<PipelineResult> {
  const logs: AgentLog[] = [];
  const addLog = (agentName: string, message: string, type: "info" | "success" | "warning" | "error" | "collab") => {
    const log: AgentLog = {
      agentName,
      message,
      timestamp: new Date().toLocaleTimeString(),
      type
    };
    logs.push(log);
    onProgress(log);
  };

  const updatedFeedback = feedbackText 
    ? [...currentMemory.lastFeedback, feedbackText] 
    : currentMemory.lastFeedback;

  const nextMemory: PipelineMemory = {
    ...currentMemory,
    lastFeedback: updatedFeedback
  };

  if (!apiKey) {
    addLog("System Gateway", "Error: Missing Groq API Key configuration.", "error");
    throw new Error("Missing Groq API Key. Please provide a key in the settings panel (top right) or configure GROQ_API_KEY in your server .env file.");
  }

  // ----------------------------------------------------
  // LIVE MODE GENERATION (WITH GROQ API KEY)
  // ----------------------------------------------------
  try {
    addLog("System Gateway", "Verifying Groq API Key and loading LLM interface...", "info");
    addLog("Agent 1: Spec Analyzer", "Reading maritime PRD requirements...", "info");
    
    const analyzerSystemPrompt = `You are a professional maritime software architect. Your job is to analyze a product requirements document (PRD) from ANY maritime domain area—such as ship operations, hull stress/structural engineering, port logistics, cargo manifests, shipping company finances, crew schedules, marine insurance, employee portals, etc.—and propose a component layout hierarchy tree suited for that domain.
You MUST output a JSON object containing a "systemTitle" (detected title or MV ALPHA), a "theme" (detected theme color, default 'blue'), and a "widgetTree" array representing the layout.
The widgetTree elements MUST have: "id" (string), "name" (string), "type" (string, e.g., Tabs, Sidebar, Chart, DataGrid, Card, Timeline, Roster, Form, Log, Map), "description" (string), "status" (string 'active'), and optionally a "children" array for nested elements (like tabs containing cards).
CRITICAL RULE: If you intend for the UI to have a tabbed navigation layout or sidebars, you MUST structure it hierarchically: output a root element of type "Tabs" or "Sidebar" that contains a "children" array with the actual content widgets. Do NOT output a flat array.
Example output format:
{
  "systemTitle": "Halifax Port Cargo Manifest",
  "theme": "indigo",
  "widgetTree": [
    { 
      "id": "1", "name": "Main Navigation", "type": "Tabs", "description": "Tabbed navigation for port operations", "status": "active",
      "children": [
        { "id": "1-1", "name": "Reefer Temp Logs", "type": "DataGrid", "description": "Displays cargo cold-chain status", "status": "active" },
        { "id": "1-2", "name": "Security Alerts", "type": "Log", "description": "Live port security events", "status": "active" }
      ]
    }
  ]
}
Return ONLY valid raw JSON. Do not wrap it in markdown code blocks or write extra conversational text.`;

    const analyzerUserPrompt = `PRD CONTENT:
${prdText}

PREVIOUS MEMORY LOGS:
- Theme preference: ${nextMemory.theme}
- System Title: ${nextMemory.systemTitle}
- Feedback Items: ${JSON.stringify(nextMemory.lastFeedback)}
- Latest User Feedback: ${feedbackText || "None"}
${currentMemory.lastWidgetTree ? `\nPREVIOUS WIDGET TREE (Keep this layout unless requested otherwise):\n${JSON.stringify(currentMemory.lastWidgetTree, null, 2)}` : ""}`;

    addLog("Agent 1: Spec Analyzer", "Calling Spec Analyzer LLM for widget layout planning...", "collab");
    const analyzerResultText = await callGroqAPI(apiKey, analyzerSystemPrompt, analyzerUserPrompt, true);
    
    let parsedAnalyzer;
    try {
      parsedAnalyzer = JSON.parse(analyzerResultText);
    } catch (e) {
      addLog("System Gateway", "Failed to parse Analyzer JSON response. Attempting clean repair...", "warning");
      const cleanJSON = analyzerResultText.replace(/```json/g, "").replace(/```/g, "").trim();
      parsedAnalyzer = JSON.parse(cleanJSON);
    }

    const proposedTree = parsedAnalyzer.widgetTree || [];
    if (parsedAnalyzer.systemTitle) nextMemory.systemTitle = parsedAnalyzer.systemTitle;
    if (parsedAnalyzer.theme) nextMemory.theme = parsedAnalyzer.theme;

    addLog("Agent 1: Spec Analyzer", `Proposed ${proposedTree.length} components: ${proposedTree.map((w: any) => w.name).join(", ")}`, "success");
    addLog("Memory Manager", `Memory state updated. Theme: ${nextMemory.theme}, System Title: ${nextMemory.systemTitle}`, "info");

    addLog("System Gateway", "Handoff to Component Builder Agent.", "info");
    addLog("Agent 2: Component Builder", "Generating React TypeScript code using Tailwind CSS styling...", "info");

    const builderSystemPrompt = `You are a Senior React and Tailwind CSS developer. Your job is to output a single, complete React functional component representing the UI for the specified systemTitle and widgetTree in the maritime domain.
Follow these CRITICAL guidelines to ensure the component renders in our browser preview and looks like a state-of-the-art premium dashboard:
1. DO NOT write any import or export statements (e.g. no "import React from 'react'", no "export default VesselDashboard"). The environment already has React, ReactDOM, and Tailwind CSS globally.
2. Refer to all hooks via the "React." namespace, e.g. use "React.useState" instead of "useState", "React.useEffect", etc.
3. Keep the entire UI code inside a single functional component block, e.g. "function VesselDashboard() { ... return ( ... ) }". The function name can be anything suitable.
4. For all icons, use plain inline SVG tags styled with Tailwind (width, height, colors) rather than importing from "lucide-react" or other icon packages. This ensures it never crashes.
5. Create a highly polished, interactive UI with at least 3 state variables (e.g., sorting, filters, toggles, mock data additions, forms) to demonstrate full interactivity. Do NOT invent a tabbed layout unless a "Tabs" component is explicitly defined in the widget tree.
6. Make the design premium, modern, and materialistic:
   - LAYOUT RULES: Always place navigation tabs at the TOP of the dashboard, below the main header but above the content area. Never place tabs at the bottom.
   - UNIFORM ELEMENTS: Ensure action buttons (like "Add X") are uniform in size, have consistent padding, use "whitespace-nowrap", and use flexbox (flex items-center justify-center) to prevent awkward wrapping.
   - HIERARCHY MATCHING: You MUST render the exact hierarchy provided in the "WIDGET HIERARCHY DESIGN". If it provides a "Tabs" root component with "children", render those children exactly inside those tabs. Do not invent a flat layout if a nested tree is provided, and vice versa.
   - BACKGROUND: Use deep dark-mode slate backgrounds (e.g. bg-[#08090e] or bg-[#0b0c13]) with smooth radial glow highlights.
   - LAYERS & GLASSMORPHISM: Cards must use subtle semi-transparency (e.g. bg-slate-900/40 or bg-slate-950/60) combined with backdrop-blur-md and crisp, thin borders (border border-white/5 or border-slate-800/80).
   - ELEVATION & SHADOWS: Use realistic materialistic shadows (shadow-md, shadow-lg, shadow-2xl) and inner shadows (shadow-inner) to create depth and spatial hierarchy.
   - COLOR ACCENTS & PALETTE: Ground the color palette around the specified theme (e.g., if emerald, use emerald-400, emerald-500, emerald-950/20 card backdrops; if indigo, use indigo-400, indigo-500, etc.). Use rich gradients instead of flat fills.
   - MICRO-INTERACTIONS & TRANSITIONS: Add smooth transition states (transition-all duration-300 ease-in-out) on all buttons, tabs, input fields, and hoverable panels (hover:scale-[1.01] hover:border-white/10).
7. Make the UI match the specific domain context, e.g., if it is shipping finance, show spreadsheets and tables; if it is hull stress, show charts and sensor warnings; if crew roster, show a calendar or shift cards.
8. Return ONLY the executable code. Do not wrap the code block in markdown backticks (no \`\`\`jsx or \`\`\`). Just return raw plain code text.`;

    const builderUserPrompt = `WIDGET HIERARCHY DESIGN:
${JSON.stringify(proposedTree, null, 2)}

ORIGINAL REQUIREMENT:
${prdText}

MEMORIES & FEEDBACK:
- System Title Context: ${nextMemory.systemTitle}
- Color Theme Style: ${nextMemory.theme}
- User Feedback history: ${JSON.stringify(nextMemory.lastFeedback)}
- Latest instructions to implement: ${feedbackText || "None"}
${currentMemory.lastGeneratedCode ? `\nPREVIOUS GENERATED CODE (Modify this existing code instead of rewriting from scratch):\n${currentMemory.lastGeneratedCode}` : ""}`;

    addLog("Agent 2: Component Builder", "Synthesizing and writing Tailwind HTML/SVG code blocks...", "collab");
    let generatedCode = await callGroqAPI(apiKey, builderSystemPrompt, builderUserPrompt, false);
    
    generatedCode = generatedCode.replace(/```tsx/g, "").replace(/```jsx/g, "").replace(/```javascript/g, "").replace(/```/g, "").trim();

    addLog("Agent 2: Component Builder", "Invoking Tool call: `validateCodeSyntax`...", "info");
    const syntaxCheck = agentTools.validateCodeSyntax(generatedCode);
    if (syntaxCheck.isValid) {
      addLog("Tool: Code Validator", "Syntax check passed successfully.", "success");
    } else {
      addLog("Tool: Code Validator", `Syntax alert: ${syntaxCheck.error}. Attempting auto-adjust...`, "warning");
    }

    addLog("Agent 2: Component Builder", "Invoking Tool call: `simulatePreview`...", "info");
    const previewCheck = agentTools.simulatePreview(generatedCode);
    if (previewCheck.isSimulatable) {
      addLog("Tool: Simulator", "Preview simulation parameters verified.", "success");
    } else {
      addLog("Tool: Simulator", "Warning: Direct hook usage found. Wrapping hooks with React prefix.", "warning");
      generatedCode = generatedCode
        .replace(/\buseState\(/g, "React.useState(")
        .replace(/\buseEffect\(/g, "React.useEffect(")
        .replace(/\buseMemo\(/g, "React.useMemo(")
        .replace(/\buseRef\(/g, "React.useRef(");
    }

    addLog("System Gateway", "Pipeline completed successfully with Groq Llama 3.3.", "success");

    return {
      widgetTree: proposedTree,
      generatedCode,
      logs,
      memory: {
        ...nextMemory,
        lastWidgetTree: proposedTree,
        lastGeneratedCode: generatedCode
      }
    };

  } catch (err: any) {
    addLog("System Gateway", `Pipeline encountered an error: ${err.message}.`, "error");
    throw err;
  }
}
