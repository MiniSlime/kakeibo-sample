import { mastra } from "@/mastra";
import { toAISdkFormat } from "@mastra/ai-sdk";
import { createUIMessageStreamResponse, UIMessage } from "ai";
import { setImageUrlForRun } from "@/mastra/tools/receipt-ocr-tool";

export const maxDuration = 300;

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();
  const agent = mastra.getAgent("kakeiboAgent");
  
  let extractedImageUrl: string | null = null;
  
  for (const msg of messages) {
    if (msg.role === 'user' && 'parts' in msg && Array.isArray(msg.parts)) {
      const filePart = msg.parts.find((p) => 
        typeof p === 'object' && p !== null && 'type' in p && p.type === 'file'
      );
      
      if (filePart && 'url' in filePart && typeof filePart.url === 'string') {
        extractedImageUrl = filePart.url;
        break;
      }
    }
  }
  
  const processedMessages: UIMessage[] = messages.map((msg) => {
    if (msg.role === 'user' && 'parts' in msg && Array.isArray(msg.parts)) {
      const hasFile = msg.parts.some((p) => 
        typeof p === 'object' && p !== null && 'type' in p && p.type === 'file'
      );
      
      if (hasFile) {
        const nonFileParts = msg.parts.filter((p) => 
          !(typeof p === 'object' && p !== null && 'type' in p && p.type === 'file')
        );
        
        return {
          ...msg,
          parts: [
            ...nonFileParts,
            {
              type: 'text' as const,
              text: `\n\n[システム: ユーザーがレシート画像をアップロードしました。receipt-ocrツールを使用してください]`,
            },
          ],
        };
      }
    }
    return msg;
  });
  
  const result = await agent.stream(processedMessages);

  if (extractedImageUrl && 'runId' in result && typeof result.runId === 'string') {
    setImageUrlForRun(result.runId, extractedImageUrl);
  }

  return createUIMessageStreamResponse({
    stream: toAISdkFormat(result, { from: "agent" }),
  });
}
