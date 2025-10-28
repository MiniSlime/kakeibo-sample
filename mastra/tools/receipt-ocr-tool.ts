import { createTool } from '@mastra/core/tools';
import { z } from 'zod';

// グローバルストレージ: runIdごとに画像URLを保存
const imageUrlStorage = new Map<string, string>();

export function setImageUrlForRun(runId: string, imageUrl: string) {
  console.log(`[receipt-ocr-tool] Storing imageUrl for runId: ${runId}, length: ${imageUrl.length}`);
  imageUrlStorage.set(runId, imageUrl);
}

export function clearImageUrlForRun(runId: string) {
  imageUrlStorage.delete(runId);
}

// 画像URLをbase64エンコードされたData URLに変換
async function imageUrlToBase64(imageUrl: string): Promise<string> {
  try {
    // すでにdata URLの場合はそのまま返す
    if (imageUrl.startsWith('data:')) {
      console.log('[receipt-ocr-tool] Image is already a data URL');
      return imageUrl;
    }

    // HTTPSのURLの場合は警告を出すが、処理は続行
    if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
      console.warn('[receipt-ocr-tool] ⚠️ 外部URLが渡されました。エージェントがdata URLを使用していない可能性があります。');
      console.warn('[receipt-ocr-tool] URL:', imageUrl);

      // エラーではなく警告として扱い、そのまま返す
      // OpenAI Vision APIは外部URLも受け付けるため
      return imageUrl;
    }

    // その他の場合はそのまま返す
    console.log('[receipt-ocr-tool] Returning image URL as-is');
    return imageUrl;
  } catch (error) {
    console.error('[receipt-ocr-tool] Failed to process image:', error);
    if (error instanceof Error) {
      throw new Error(`画像の処理に失敗しました: ${error.message}`);
    }
    throw new Error(`画像の処理に失敗しました。`);
  }
}

const analyzeReceipt = async (imageUrl: string) => {
  const toolStartTime = Date.now();
  const toolStartDate = new Date().toISOString();
  try {
    console.log('[receipt-ocr-tool] ========== START ==========');
    console.log('[receipt-ocr-tool] Tool invoked at:', toolStartDate);
    console.log('[receipt-ocr-tool] Starting receipt analysis');
    console.log('[receipt-ocr-tool] Image URL length:', imageUrl.length);

    const openaiApiKey = process.env.OPENAI_API_KEY;
    if (!openaiApiKey) {
      throw new Error('OPENAI_API_KEY environment variable is not set');
    }

    console.log('[receipt-ocr-tool] Step 1: Converting image URL');
    // 画像URLをbase64 Data URLに変換
    const base64ImageUrl = await imageUrlToBase64(imageUrl);
    console.log('[receipt-ocr-tool] Step 2: Image converted, length:', base64ImageUrl.length);
    console.log('[receipt-ocr-tool] Step 2.1: Image URL prefix:', base64ImageUrl.substring(0, 100));
    console.log('[receipt-ocr-tool] Step 2.2: Image URL suffix:', base64ImageUrl.substring(base64ImageUrl.length - 50));

    const prompt = `
このレシート画像から以下の情報を抽出してJSON形式で返してください。
簡潔に、必要最小限の情報のみを返してください。

必須項目:
- storeName: 店舗名
- date: 購入日時 (YYYY-MM-DDTHH:mm:ss形式、時刻不明なら12:00:00)
- items: [{name: 商品名, quantity: 数量, price: 単価, total: 小計}]
- subtotal: 小計
- tax: 消費税
- total: 合計金額

任意項目:
- paymentMethod: 支払い方法（判読できる場合のみ）

レスポンス例:
{"storeName":"コンビニ","date":"2025-10-28T12:00:00","items":[{"name":"商品A","quantity":1,"price":100,"total":100}],"subtotal":100,"tax":10,"total":110}

不明な項目は省略または0にしてください。
`;

    console.log('[receipt-ocr-tool] Step 3: Calling OpenAI API with timeout');
    const startTime = Date.now();

    // リクエストボディの準備
    const requestBody = {
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: prompt,
            },
            {
              type: 'image_url',
              image_url: {
                url: base64ImageUrl,
                detail: 'low',
              },
            },
          ],
        },
      ],
      max_tokens: 800,
      response_format: { type: 'json_object' },
    };

    console.log('[receipt-ocr-tool] Step 3.1: Request body prepared (model, max_tokens, image length):', {
      model: requestBody.model,
      maxTokens: requestBody.max_tokens,
      imageUrlLength: base64ImageUrl.length,
    });

    // タイムアウト付きfetch
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      console.log('[receipt-ocr-tool] !!! TIMEOUT: Aborting request after 60 seconds !!!');
      controller.abort();
    }, 60000); // 60秒でタイムアウト

    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${openaiApiKey}`,
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      console.log(`[receipt-ocr-tool] Step 4: API response received in ${elapsed}s, status:`, response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[receipt-ocr-tool] OpenAI API error:', errorText);
        throw new Error(`OpenAI API error: ${response.status} ${response.statusText}. ${errorText}`);
      }

      console.log('[receipt-ocr-tool] Step 5: Parsing response JSON');
      const data = await response.json();
      const content = data.choices[0].message.content;
      console.log('[receipt-ocr-tool] Step 6: Response content length:', content.length);

      const receiptData = JSON.parse(content);

      const toolElapsed = ((Date.now() - toolStartTime) / 1000).toFixed(1);
      console.log('[receipt-ocr-tool] Step 7: Successfully analyzed receipt');
      console.log(`[receipt-ocr-tool] Total tool execution time: ${toolElapsed}s`);
      console.log('[receipt-ocr-tool] ========== END ==========');
      return {
        storeName: receiptData.storeName || '不明',
        date: receiptData.date || new Date().toISOString(),
        items: receiptData.items || [],
        subtotal: receiptData.subtotal || 0,
        tax: receiptData.tax || 0,
        total: receiptData.total || 0,
        paymentMethod: receiptData.paymentMethod,
      };
    } catch (fetchError) {
      clearTimeout(timeoutId);
      if (fetchError instanceof Error && fetchError.name === 'AbortError') {
        console.error('[receipt-ocr-tool] Request was aborted due to timeout');
        throw new Error('OpenAI APIリクエストがタイムアウトしました（60秒）。画像が大きすぎる可能性があります。');
      }
      throw fetchError;
    }
  } catch (error) {
    console.error('[receipt-ocr-tool] !!! ERROR !!!', error);
    if (error instanceof Error) {
      throw new Error(`レシート画像の解析に失敗しました: ${error.message}`);
    }
    throw new Error('レシート画像の解析に失敗しました。');
  }
};

export const receiptOcrTool = createTool({
  id: 'receipt-ocr',
  description: 'レシート画像から購入情報を抽出する',
  inputSchema: z.object({
    imageUrl: z.string().describe('レシート画像のURL（base64 data URLまたはHTTPS URLを指定）'),
  }),
  outputSchema: z.object({
    storeName: z.string().describe('店舗名'),
    date: z.string().describe('購入日時'),
    items: z.array(
      z.object({
        name: z.string().describe('商品名'),
        quantity: z.number().describe('数量'),
        price: z.number().describe('単価'),
        total: z.number().describe('小計'),
      })
    ).describe('購入商品リスト'),
    subtotal: z.number().describe('小計'),
    tax: z.number().describe('消費税'),
    total: z.number().describe('合計金額'),
    paymentMethod: z.string().optional().describe('支払い方法'),
  }),
  execute: async (params) => {
    const executeMsg = `[receipt-ocr-tool] ========== EXECUTE CALLED at ${new Date().toISOString()} ==========`;
    console.log(executeMsg);
    console.error(executeMsg); // 標準エラー出力にも
    process.stderr.write(executeMsg + '\n'); // 直接stderrに書き込み
    
    // パラメータ全体をログ出力して構造を確認
    console.log('[receipt-ocr-tool] Params keys:', Object.keys(params));
    console.log('[receipt-ocr-tool] Full params (truncated):', JSON.stringify(params, null, 2).substring(0, 500));
    
    const { context } = params;
    console.log('[receipt-ocr-tool] Context:', JSON.stringify(context).substring(0, 200));
    
    // 空文字列の場合、グローバルストレージから取得
    let imageUrl = context.imageUrl;
    if (!imageUrl || imageUrl === '') {
      // paramsの中からrunIdを探す
      const runId = (params as any).runId || (params as any).tracingContext?.currentSpan?.metadata?.runId;
      console.log('[receipt-ocr-tool] imageUrl is empty, checking storage with runId:', runId);
      if (runId) {
        const storedUrl = imageUrlStorage.get(runId);
        if (storedUrl) {
          console.log('[receipt-ocr-tool] Found stored imageUrl, length:', storedUrl.length);
          imageUrl = storedUrl;
          // 使用後はクリア
          clearImageUrlForRun(runId);
        } else {
          console.log('[receipt-ocr-tool] No stored imageUrl found for runId');
        }
      } else {
        console.log('[receipt-ocr-tool] No runId available in params');
      }
    }
    
    const result = await analyzeReceipt(imageUrl);
    const completeMsg = '[receipt-ocr-tool] ========== EXECUTE COMPLETED ==========';
    console.log(completeMsg);
    console.error(completeMsg);
    return result;
  },
});
