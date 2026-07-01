import {AnthropicBedrock} from "@anthropic-ai/bedrock-sdk";

// 認証情報は環境変数（AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_SESSION_TOKEN）
// もしくは共有プロファイルから解決されます。README の `claude-start` 実行後のシェルでそのまま動作します。
const client = new AnthropicBedrock({
  awsRegion: "us-east-1",
});

const message = await client.messages.create({
  model: "us.anthropic.claude-haiku-4-5-20251001-v1:0",
  max_tokens: 64,
  messages: [{role: "user", content: "自己紹介してください"}],
});

console.log(message.content[0].text);
