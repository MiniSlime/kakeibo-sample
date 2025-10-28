import { mastra } from "@/mastra"; // 1️⃣
import { toAISdkFormat } from "@mastra/ai-sdk";
import { createUIMessageStreamResponse, UIMessage } from "ai";
import { setImageUrlForRun } from "@/mastra/tools/receipt-ocr-tool";

// Allow streaming responses up to 5 minutes for image processing
export const maxDuration = 300;

export async function POST(req: Request) {
  console.log('[API] ========== CHAT API REQUEST START ==========');
  const startTime = Date.now();
  
  const { messages }: { messages: UIMessage[] } = await req.json();
  console.log('[API] Received messages count:', messages.length);
  
  // 最後のメッセージの内容を確認
  const lastMessage = messages[messages.length - 1];
  console.log('[API] Last message role:', lastMessage.role);
  console.log('[API] Last message preview:', JSON.stringify(lastMessage).substring(0, 200));
  
  // メッセージ内の画像部分を詳細ログ
  if ('parts' in lastMessage && Array.isArray(lastMessage.parts)) {
    const fileParts = lastMessage.parts.filter((p: unknown) => {
      return typeof p === 'object' && p !== null && 'type' in p && p.type === 'file';
    });
    console.log('[API] File parts count:', fileParts.length);
    if (fileParts.length > 0) {
      const firstFile = fileParts[0] as { url?: string };
      console.log('[API] First file URL prefix:', firstFile.url?.substring(0, 50));
      console.log('[API] First file URL length:', firstFile.url?.length);
    }
  }
  
  console.log('[API] Getting kakeiboAgent...');
  const agent = mastra.getAgent("kakeiboAgent"); // 2️⃣
  
  // 画像URLを抽出（ツール呼び出し用）
  let extractedImageUrl: string | null = null;
  console.log('[API] Extracting image URL from message...');
  
  for (const msg of messages) {
    if (msg.role === 'user' && 'parts' in msg && Array.isArray(msg.parts)) {
      const filePart = msg.parts.find((p) => 
        typeof p === 'object' && p !== null && 'type' in p && p.type === 'file'
      );
      
      if (filePart && 'url' in filePart && typeof filePart.url === 'string') {
        extractedImageUrl = filePart.url;
        console.log('[API] Extracted image URL (length:', filePart.url.length, ')');
        break;
      }
    }
  }
  
  // 画像ファイルを簡潔なテキスト指示に変換
  const processedMessages: UIMessage[] = messages.map((msg) => {
    if (msg.role === 'user' && 'parts' in msg && Array.isArray(msg.parts)) {
      const hasFile = msg.parts.some((p) => 
        typeof p === 'object' && p !== null && 'type' in p && p.type === 'file'
      );
      
      if (hasFile) {
        // 画像以外のpartsを保持
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
  
  console.log('[API] Calling agent.stream()...');
  const streamStartTime = Date.now();
  const result = await agent.stream(processedMessages); // 簡潔化したメッセージ
  const streamElapsed = ((Date.now() - streamStartTime) / 1000).toFixed(1);
  console.log(`[API] agent.stream() completed in ${streamElapsed}s`);

  // 画像URLが抽出されている場合、グローバルストレージに保存
  if (extractedImageUrl && 'runId' in result && typeof result.runId === 'string') {
    console.log('[API] Storing extracted imageUrl for runId:', result.runId);
    setImageUrlForRun(result.runId, extractedImageUrl);
  }

  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[API] Creating response stream...`);
  console.log(`[API] ========== CHAT API REQUEST END (${totalElapsed}s) ==========`);
  console.log('[API] Note: Actual tool execution happens during stream consumption');

  // Return the result as a data stream response
  // Workaround: https://discord.com/channels/1309558646228779139/1313241662091694100/1425928259513749554
  const response = createUIMessageStreamResponse({
    stream: toAISdkFormat(
      result,
      { from: "agent" },
    ),
  });
  
  console.log('[API] Response created, returning to client');
  return response;
}
