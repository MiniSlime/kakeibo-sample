import { mastra } from "@/mastra";
import { UIMessage } from "ai";
import { setImageUrlForRun } from "@/mastra/tools/receipt-ocr-tool";

export const maxDuration = 300;

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

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

  const result = await run.start({
    inputData: {
      imageUrl: extractedImageUrl || '',
      category: '未分類',
    },
  });

  console.log('[DEBUG] Workflow status:', result.status);
  if (result.status === 'success') {
    console.log('[DEBUG] Workflow result:', result.result);
  } else if (result.status === 'failed') {
    console.log('[DEBUG] Workflow error:', result.error);
  }

  // ストリーミングレスポンスを作成
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      let message = '';

      if (result.status === 'success') {
        console.log('[DEBUG] Success result:', result.result);
        message = result.result.message || '処理が完了しました';
      } else if (result.status === 'failed') {
        console.error('[ERROR] Workflow failed:', result.error);
        message = `エラーが発生しました: ${result.error || '不明なエラー'}`;
      } else {
        console.log('[DEBUG] Workflow suspended');
        message = 'ワークフローが一時停止しています';
      }

      // テキストチャンクとして送信
      const textChunk = `0:"${message.replace(/"/g, '\\"')}"\n`;
      controller.enqueue(encoder.encode(textChunk));

      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'X-Vercel-AI-Data-Stream': 'v1',
    },
  });
}
