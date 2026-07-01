#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib/core';
import {BedrockClaudeCdkStack} from '../lib/bedrock-claude-cdk-stack';

const app = new cdk.App();
new BedrockClaudeCdkStack(app, 'BedrockClaudeCdkStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION || 'ap-northeast-1'
  },
});
