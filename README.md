# Bedrock Claude CDK

Amazon Bedrock（Anthropic Claude）を **Claude Code CLI** や自作アプリから安全に利用するための、以下リソースを一括構築する
CDK スタックです。

- Bedrock (`InvokeModel` / `InvokeModelWithResponseStream` / `GetFoundationModel` / `ListFoundationModels`) 呼び出し用の IAM ポリシー
- AWS Marketplace 購読確認用の IAM ポリシー
- 一時認証情報（STS `AssumeRole`）を発行する IAM ロール `claude-code-sts-role`
- 月額 $50 の **AWS Budgets** アラート（80% / 100% 到達時にメール通知）でクラウド破産防止

長期的なアクセスキーを発行せず、**STS の一時認証情報**で Bedrock を呼び出す設計です。
CloudFormation の Output に出力されるロール ARN を `assume-role` することで、有効期限付きの認証情報を取得します。

---

## 1. 前提条件

| 項目              | バージョン / 内容                                                         |
|-----------------|--------------------------------------------------------------------|
| Node.js         | 18 以上（推奨: 20 LTS）                                                  |
| npm             | 9 以上                                                               |
| AWS CLI         | v2 系                                                               |
| AWS CDK CLI     | **2.1129.0 以上**（`npm i -g aws-cdk@latest`）                         |
| AWS アカウント       | Bedrock が利用可能なリージョン（例: `us-east-1`, `us-west-2`, `ap-northeast-1`） |
| Bedrock モデルアクセス | AWS コンソールで **Claude** モデルの利用申請が承認済み                                |

### Bedrock モデルの有効化（初回のみ）

1. AWS コンソール → **Amazon Bedrock** → 左メニュー **Model access** を開く
2. 利用したい Anthropic Claude モデル（例: Claude Opus 4.8, Claude Haiku 4.5 等）を選択し **Request model access**
3. ステータスが **Access granted** になるのを確認

> Bedrock のモデルアクセスを付与していないと、IAM 権限があっても `AccessDeniedException` になります。

---

## 2. デプロイ手順

### 2.1 依存関係のインストール

```bash
npm ci
```

### 2.2 通知メールと予算の設定

`lib/bedrock-claude-cdk-stack.ts` を編集：

```ts
const notificationEmail = 'your-email@example.com'; // ← 実在するメールアドレスに変更
const monthlyBudgetLimit = 50;                       // ← 必要に応じて上限USDを変更
```

### 2.3 デプロイ先アカウント / リージョンの指定（任意）

`bin/bedrock-claude-cdk.ts` の `env` で指定します（デフォルトのリージョンは `ap-northeast-1`）：

```ts
new BedrockClaudeCdkStack(app, 'BedrockClaudeCdkStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'ap-northeast-1',
  },
});
```

### 2.4 AWS 認証情報の設定

管理者権限のあるプロファイルで実行してください。

```bash
export AWS_PROFILE=your-admin-profile
export AWS_REGION=us-east-1            # Bedrock が有効なリージョン
aws sts get-caller-identity            # 動作確認
```

### 2.5 ビルド & Bootstrap（初回のみ）

```bash
npm run build
npx cdk bootstrap
```

### 2.6 差分確認 → デプロイ

```bash
npx cdk diff
npx cdk deploy
```

デプロイ完了後、以下の `Outputs` が表示されます。

| Output キー             | 内容                                          |
|-----------------------|---------------------------------------------|
| `ClaudeCodeRoleArn`   | `assume-role` する IAM ロール（`claude-code-sts-role`）の ARN |

> Budgets 通知メールは初回 **確認メール（Confirm subscription）** をクリックしないと届きません。

---

## 3. 一時認証情報（STS）の取得

出力された `ClaudeCodeRoleArn` を `assume-role` して、有効期限付きの認証情報を取得します。

```bash
ROLE_ARN=$(aws cloudformation describe-stacks \
  --stack-name BedrockClaudeCdkStack \
  --query "Stacks[0].Outputs[?OutputKey=='ClaudeCodeRoleArn'].OutputValue" \
  --output text)

aws sts assume-role \
  --role-arn "$ROLE_ARN" \
  --role-session-name "ClaudeCodeSession" \
  --duration-seconds 3600
```

> このロールは同一アカウント（`AccountRootPrincipal`）から `assume-role` できます。
> 長期アクセスキーを発行しないため、認証情報は最長 1 時間で自動失効します。

---

## 4. Claude Code CLI での利用手順

[Claude Code](https://docs.anthropic.com/claude/docs/claude-code) は Amazon Bedrock をバックエンドに指定できます。

### 4.1 Claude Code CLI のインストール

```bash
npm install -g @anthropic-ai/claude-code
```

### 4.2 環境変数と起動ラッパーの設定

`~/.zshrc` もしくは `~/.bashrc` に以下を追記します。
`claude` コマンドを実行するたびに STS で一時認証情報を取得し、Bedrock 経由で Claude Code を起動します。

```bash
# ==========================================
# Claude Code 環境変数のクリア関数
# ==========================================
claude-clean() {
  unset CLAUDE_CODE_USE_BEDROCK
  unset AWS_REGION
  unset AWS_ACCESS_KEY_ID
  unset AWS_SECRET_ACCESS_KEY
  unset AWS_SESSION_TOKEN
  echo "✅ Bedrock credentials and settings cleared."
}

# ==========================================
# Claude Code 起動用ラッパー関数
# ==========================================
claude-start() {
  # 既に Bedrock 用の環境変数がセットされていればクリアしてから取得し直す
  if [ "$CLAUDE_CODE_USE_BEDROCK" = "1" ]; then
    claude-clean
  fi

  local STACK_NAME="BedrockClaudeCdkStack" # CDKで定義したスタック名
  export AWS_REGION="us-east-1"            # Bedrock が有効なリージョン

  # CloudFormation から Role ARN を取得
  local ROLE_ARN=$(aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    --query "Stacks[0].Outputs[?OutputKey=='ClaudeCodeRoleArn'].OutputValue" \
    --output text 2>/dev/null)

  if [ -z "$ROLE_ARN" ]; then
    echo "❌ Role ARNが見つかりません。デプロイされているか確認してください。"
    return 1
  fi

  # STS で一時認証情報を取得
  local CREDENTIALS=$(aws sts assume-role \
    --role-arn "$ROLE_ARN" \
    --role-session-name "ClaudeCodeSession" \
    --duration-seconds 3600 \
    --query "Credentials.[AccessKeyId,SecretAccessKey,SessionToken]" \
    --output text)

  # 環境変数にセット
  export AWS_ACCESS_KEY_ID=$(echo "$CREDENTIALS" | awk '{print $1}')
  export AWS_SECRET_ACCESS_KEY=$(echo "$CREDENTIALS" | awk '{print $2}')
  export AWS_SESSION_TOKEN=$(echo "$CREDENTIALS" | awk '{print $3}')

  # Bedrock 設定
  export CLAUDE_CODE_USE_BEDROCK=1
  export ANTHROPIC_MODEL="us.anthropic.claude-opus-4-8"
  export ANTHROPIC_SMALL_FAST_MODEL="us.anthropic.claude-haiku-4-5-20251001-v1:0"

  echo "🚀 STS Credentials active. Starting Claude Code..."
  command claude "$@"
}

# いつもの「claude」コマンドでこの関数が動くようにエイリアスを設定
alias claude=claude-start
```

反映：

```bash
source ~/.zshrc
```

### 4.3 利用可能モデルの確認

```bash
aws bedrock list-foundation-models \
  --region us-east-1 \
  --by-provider anthropic \
  --query "modelSummaries[*].modelId" \
  --output table
```

### 4.4 動作確認

```bash
claude --version
claude "こんにちは。あなたのモデル名を教えてください。"
```

Bedrock 経由で応答が返れば成功です。

---

## 5. 自作アプリケーションからの利用

STS で取得した一時認証情報を環境変数にセットすれば、そのまま AWS SDK / boto3 から Bedrock を呼び出せます
（`claude-start` 実行後のシェルなど）。

### 5.1 Node.js（`@anthropic-ai/bedrock-sdk`）からの呼び出し例

`sample/bedrock-call-sample.mjs` を参照してください。

```bash
node sample/bedrock-call-sample.mjs
```

### 5.2 Python (boto3) からの呼び出し例

```python
import boto3, json

client = boto3.client("bedrock-runtime", region_name="us-east-1")

resp = client.invoke_model(
    modelId="us.anthropic.claude-haiku-4-5-20251001-v1:0",
    body=json.dumps({
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": 512,
        "messages": [{"role": "user", "content": "自己紹介してください"}],
    }),
    contentType="application/json",
)
print(json.loads(resp["body"].read())["content"][0]["text"])
```

---

## 6. 運用 Tips

- **予算アラート**: 80% / 100% でメールが飛びます。閾値やメール先は `lib/bedrock-claude-cdk-stack.ts` で調整。
- **一時認証情報の有効期限**: `assume-role` の `--duration-seconds` で調整（デフォルト 1 時間、最大はロールの `MaxSessionDuration` に依存）。失効したら `claude-start` を再実行するだけで再取得されます。
- **モデル ID の確認**: `aws bedrock list-inference-profiles --region us-east-1` で利用可能な推論プロファイル ID を取得できます。
- **リージョン**: モデルアクセスを有効化したリージョンと `AWS_REGION` を必ず一致させます。

---

## 7. スタックの削除

```bash
npx cdk destroy
```

IAM ロールと Budgets はスタック削除時にそのまま削除されます。

---

## 8. 便利コマンド

| コマンド              | 説明                             |
|-------------------|--------------------------------|
| `npm run build`   | TypeScript を JavaScript にコンパイル |
| `npm run watch`   | ファイル変更を監視して自動コンパイル             |
| `npm run test`    | jest によるユニットテスト                |
| `npx cdk synth`   | CloudFormation テンプレートを生成       |
| `npx cdk diff`    | 現在のデプロイとの差分表示                  |
| `npx cdk deploy`  | スタックをデプロイ                      |
| `npx cdk destroy` | スタックを削除                        |

---

## 9. トラブルシューティング

| 症状                                                      | 対処                                                          |
|---------------------------------------------------------|-------------------------------------------------------------|
| `Cloud assembly schema version mismatch`                | `npm i -g aws-cdk@latest` で CDK CLI を更新                     |
| `AccessDeniedException` on `InvokeModel`                | Bedrock コンソールで対象モデルの **Model access** を承認 / リージョンが一致しているか確認 |
| `The security token included in the request is invalid` | 一時認証情報が失効。`claude-start` を再実行して取得し直す                        |
| Budgets のメールが届かない                                       | 初回に届く `AWS Notifications` の確認メール（Confirm subscription）をクリック |
