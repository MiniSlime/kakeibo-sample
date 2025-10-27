import { mastra } from "@/mastra"; // 1️⃣
import { toAISdkFormat } from "@mastra/ai-sdk";
import { createUIMessageStreamResponse, UIMessage } from "ai";

// Allow streaming responses up to 30 seconds
export const maxDuration = 30;

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();
  const agent = mastra.getAgent("weatherAgent"); // 2️⃣
  const result = await agent.stream(messages); // 3️⃣

  // Return the result as a data stream response
  // Workaround: https://discord.com/channels/1309558646228779139/1413241662091694100/1425928259513749554
  return createUIMessageStreamResponse({
    stream: toAISdkFormat(
      result,
      { from: "agent" },
    ),
  }); // 4️⃣
}
