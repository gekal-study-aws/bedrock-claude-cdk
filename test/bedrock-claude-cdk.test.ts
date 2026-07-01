import * as cdk from 'aws-cdk-lib/core';
import {Match, Template} from 'aws-cdk-lib/assertions';
import {BedrockClaudeCdkStack} from '../lib/bedrock-claude-cdk-stack';

const synth = () => {
  const app = new cdk.App();
  const stack = new BedrockClaudeCdkStack(app, 'TestStack');
  return Template.fromStack(stack);
};

test('creates the STS role for Claude Code', () => {
  const template = synth();
  template.hasResourceProperties('AWS::IAM::Role', {
    RoleName: 'claude-code-sts-role',
  });
});

test('grants Bedrock invoke permissions', () => {
  const template = synth();
  template.hasResourceProperties('AWS::IAM::Policy', {
    PolicyDocument: {
      Statement: Match.arrayWith([
        Match.objectLike({
          Action: Match.arrayWith([
            'bedrock:InvokeModel',
            'bedrock:InvokeModelWithResponseStream',
          ]),
          Effect: 'Allow',
        }),
      ]),
    },
  });
});

test('creates a monthly budget with notifications', () => {
  const template = synth();
  template.resourceCountIs('AWS::Budgets::Budget', 1);
  template.hasResourceProperties('AWS::Budgets::Budget', {
    Budget: {
      BudgetType: 'COST',
      TimeUnit: 'MONTHLY',
    },
  });
});

test('outputs the role ARN', () => {
  const template = synth();
  template.hasOutput('ClaudeCodeRoleArn', {});
});
