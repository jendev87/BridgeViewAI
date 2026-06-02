import { NextResponse } from "next/server";
import { runPipeline } from "../../../../lib/agents/engine";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { prdText, feedbackText, apiKey, memory } = body;

    if (!prdText) {
      return NextResponse.json({ error: "Missing required parameter 'prdText'." }, { status: 400 });
    }

    // Resolve API key: Server-side environment variable OR client-side override
    const resolvedApiKey = apiKey || process.env.GROQ_API_KEY || "";

    // Run the pipeline
    // Pass a callback to collect logs in memory since the server responds in a single payload
    const result = await runPipeline(
      prdText,
      feedbackText || "",
      resolvedApiKey,
      memory || { systemTitle: "Vessel Console", theme: "blue", lastFeedback: [], customAttributes: {} },
      () => {} // Server collects logs in the return value, no-op for real-time progress callback
    );

    return NextResponse.json(result);

  } catch (err: any) {
    console.error("API Agent Pipeline Crash:", err);
    return NextResponse.json({ error: err.message || "Internal server error" }, { status: 500 });
  }
}
