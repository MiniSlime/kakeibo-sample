import { Agent } from '@mastra/core/agent';
import { spreadsheetTool } from '../tools/spreadsheet-tool';

export const csvWriterAgent = new Agent({
  name: 'CSV Writer Agent',
  instructions: `あなたはCSV記録の専門エージェントです。

## タスク
レシート情報をCSVファイルに記録してください。

## ルール
1. spreadsheet-recordツールを使用してデータを記録する
2. 受け取ったレシート情報をそのまま渡す
3. 記録結果を報告する

説明は不要です。すぐにツールを呼び出してください。`,
  model: 'openai/gpt-4o',
  tools: { spreadsheetTool },
});
