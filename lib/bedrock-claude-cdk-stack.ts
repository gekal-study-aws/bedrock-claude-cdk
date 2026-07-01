import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as budgets from 'aws-cdk-lib/aws-budgets';
import {Construct} from 'constructs';

export class BedrockClaudeCdkStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // ==========================================
    // 1. Amazon Bedrock 利用のためのIAMポリシー
    // ==========================================
    const bedrockPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'bedrock:InvokeModel',
        'bedrock:InvokeModelWithResponseStream',
        'bedrock:GetFoundationModel',
        'bedrock:ListFoundationModels',
      ],
      resources: ['*'],
    });

    // ==========================================
    // 2. AWS Marketplace 購読確認のためのIAMポリシー
    // ==========================================
    const marketplacePolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'aws-marketplace:ViewSubscriptions',
        'aws-marketplace:Subscribe',
      ],
      resources: ['*'],
    });

    // ==========================================
    // 3. 一時認証（STS）用のIAMロール作成
    // ==========================================
    const claudeRole = new iam.Role(this, 'ClaudeCodeRole', {
      roleName: 'claude-code-sts-role',
      assumedBy: new iam.AccountRootPrincipal(),
      description: 'IAM Role for Claude Code temporary STS credentials',
    });

    claudeRole.addToPolicy(bedrockPolicy);
    claudeRole.addToPolicy(marketplacePolicy);

    // ==========================================
    // 4. クラウド破産防止：AWS Budgetsによる予算アラート設定
    // ==========================================
    const notificationEmail = 'your-email@example.com';
    const monthlyBudgetLimit = 50; // 月間 $50（約7,700円）

    new budgets.CfnBudget(this, 'ClaudeMonthlyBudget', {
      budget: {
        budgetName: 'ClaudeCode-Monthly-Budget',
        budgetType: 'COST',
        timeUnit: 'MONTHLY',
        budgetLimit: {
          amount: monthlyBudgetLimit,
          unit: 'USD',
        },
      },
      notificationsWithSubscribers: [
        {
          // 80% ($40) に達した（または予測された）時点でメール送信
          notification: {
            comparisonOperator: 'GREATER_THAN',
            notificationType: 'ACTUAL',
            threshold: 80,
            thresholdType: 'PERCENTAGE',
          },
          subscribers: [
            {
              address: notificationEmail,
              subscriptionType: 'EMAIL',
            },
          ],
        },
        {
          // 100% ($50) に達した時点でメール送信
          notification: {
            comparisonOperator: 'GREATER_THAN',
            notificationType: 'ACTUAL',
            threshold: 100,
            thresholdType: 'PERCENTAGE',
          },
          subscribers: [
            {
              address: notificationEmail,
              subscriptionType: 'EMAIL',
            },
          ],
        },
      ],
    });

    // ==========================================
    // 5. クライアント（CLI）連携用の CloudFormation Output
    // ==========================================
    new cdk.CfnOutput(this, 'ClaudeCodeRoleArn', {
      value: claudeRole.roleArn,
    });
  }
}