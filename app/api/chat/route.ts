import { mastra } from "@/mastra";
import { setImageUrlForRun } from "@/mastra/tools/receipt-ocr-tool";
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";

export const maxDuration = 300;

export async function POST(req: Request) {
  const { messages } = await req.json();

  let extractedImageUrl: string | null = null;

  for (const msg of messages) {
    if (msg.role === 'user' && 'parts' in msg && Array.isArray(msg.parts)) {
      const filePart = msg.parts.find((p: any) =>
        typeof p === 'object' && p !== null && 'type' in p && p.type === 'file'
      );

      if (filePart && 'url' in filePart && typeof filePart.url === 'string') {
        extractedImageUrl = filePart.url;
        break;
      }
    }
  }

  const workflow = mastra.getWorkflow("kakeiboWorkflow");
  const run = await workflow.createRunAsync();

  const imageUrlPreview = extractedImageUrl
    ? (extractedImageUrl.startsWith('data:') ? `data URL (${extractedImageUrl.length} chars)` : extractedImageUrl)
    : 'null';

  console.log('[DEBUG] Run ID:', run.runId);
  console.log('[DEBUG] Extracted imageUrl:', imageUrlPreview);

  if (extractedImageUrl) {
    setImageUrlForRun(run.runId, extractedImageUrl);
  }

  const workflowResult = await run.start({
    inputData: {
      imageUrl: extractedImageUrl || '',
      category: '未分類',
    },
  });

  console.log('[DEBUG] Workflow status:', workflowResult.status);
  if (workflowResult.status === 'success') {
    console.log('[DEBUG] Workflow result:', workflowResult.result);
  } else if (workflowResult.status === 'failed') {
    console.log('[DEBUG] Workflow error:', workflowResult.error);
  }

  let responseMessage = '';
  if (workflowResult.status === 'success') {
    responseMessage = workflowResult.result.message || '処理が完了しました';
  } else if (workflowResult.status === 'failed') {
    responseMessage = `エラーが発生しました: ${workflowResult.error || '不明なエラー'}`;
  } else {
    responseMessage = 'ワークフローが一時停止しています';
  }

  console.log('[DEBUG] Final message:', responseMessage);

  // AI SDKのstreamTextを使ってassistant-ui互換のレスポンスを返す
  const result = streamText({
    model: openai("gpt-4o"),
    messages: [
      {
        role: "system",
        content: "ユーザーに以下のメッセージを伝えてください。そのまま返答してください。",
      },
      {
        role: "user",
        content: responseMessage,
      },
    ],
  });

  return result.toUIMessageStreamResponse();
}
