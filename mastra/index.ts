
import { Mastra } from '@mastra/core/mastra';
import { PinoLogger } from '@mastra/loggers';
import { kakeiboWorkflow } from './workflows/kakeibo-workflow';
import { kakeiboAgent } from './agents/kakeibo-agent';


export const mastra = new Mastra({
  workflows: { kakeiboWorkflow },
  agents: { kakeiboAgent },
  logger: new PinoLogger({
    name: 'Mastra',
    level: 'debug', // infoからdebugに変更してより詳細なログを出力
  }),
  telemetry: {
    // Telemetry is deprecated and will be removed in the Nov 4th release
    enabled: false, 
  },
  observability: {
    // Enables DefaultExporter and CloudExporter for AI tracing
    default: { enabled: true }, 
  },
});
