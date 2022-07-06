/**
 * SPDX-License-Identifier: Apache-2.0
 *
 * The OpenSearch Contributors require contributions made to
 * this file be licensed under the Apache-2.0 license or a
 * compatible open source license.
 */

import { Bucket } from '@aws-cdk/aws-s3';
import {
  CloudFrontAllowedMethods, CloudFrontWebDistribution, LambdaEdgeEventType, OriginAccessIdentity,
} from '@aws-cdk/aws-cloudfront';
import { CanonicalUserPrincipal, PolicyStatement } from '@aws-cdk/aws-iam';
import { NodejsFunction } from '@aws-cdk/aws-lambda-nodejs';
import { Architecture, Runtime } from '@aws-cdk/aws-lambda';
import { CfnOutput, Duration } from '@aws-cdk/core';
import { CiCdnStack } from '../ci-cdn-stack';

export class ArtifactsPublicAccess {
  constructor(stack: CiCdnStack, buildBucketArn: string) {
    const buildBucket = Bucket.fromBucketArn(stack, 'artifactBuildBucket', `${buildBucketArn.toString()}`);

    const originAccessIdentity = new OriginAccessIdentity(stack, 'cloudfront-OAI', {
      comment: `OAI for ${buildBucket.bucketName}`,
    });

    buildBucket.addToResourcePolicy(new PolicyStatement({
      actions: ['s3:GetObject'],
      resources: [buildBucket.arnForObjects('*')],
      principals: [new CanonicalUserPrincipal(originAccessIdentity.cloudFrontOriginAccessIdentityS3CanonicalUserId)],
    }));

    const urlRewriter = new NodejsFunction(stack, 'CfUrlRewriter', {
      runtime: Runtime.NODEJS_14_X,
      entry: `${__dirname}/../../resources/cf-url-rewriter/cf-url-rewriter.ts`,
      handler: 'handler',
      memorySize: 128,
      architecture: Architecture.X86_64,
    });

    const distro = new CloudFrontWebDistribution(stack, 'CloudFrontBuildBucket', {
      originConfigs: [
        {
          s3OriginSource: {
            s3BucketSource: buildBucket,
            originAccessIdentity,
          },
          behaviors: [
            {
              isDefaultBehavior: true,
              compress: true,
              allowedMethods: CloudFrontAllowedMethods.GET_HEAD,
              lambdaFunctionAssociations: [{
                eventType: LambdaEdgeEventType.VIEWER_REQUEST,
                lambdaFunction: urlRewriter.currentVersion,
              }],
              defaultTtl: Duration.seconds(300),
            },
          ],
        },
      ],
    });

    new CfnOutput(stack, 'BuildDistributionDomainName', {
      value: distro.distributionDomainName,
      description: 'The domain name where the build artifacts will be available',
    });
  }
}