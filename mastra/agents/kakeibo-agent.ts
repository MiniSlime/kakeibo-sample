import { Agent } from '@mastra/core/agent';
import { receiptOcrTool } from '../tools/receipt-ocr-tool';
import { spreadsheetTool } from '../tools/spreadsheet-tool';

export const kakeiboAgent = new Agent({
  name: 'Kakeibo Agent',
  instructions: `あなたは家計簿アシスタントです。

## ルール
1. ユーザーが「レシート画像をアップロードしました」というシステムメッセージを受け取ったら、すぐにreceipt-ocrツールを呼び出す
2. receipt-ocrツールのimageUrl引数には、空文字列""を渡す（システムが自動的に正しいURLを設定します）
3. 「記録して」と言われたら、OCR結果をspreadsheet-recordツールで記録

説明不要。すぐにツール呼び出し。`,
  model: 'openai/gpt-4o',
  tools: { receiptOcrTool, spreadsheetTool },
});
