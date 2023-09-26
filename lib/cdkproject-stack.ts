import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { CfnOutput } from 'aws-cdk-lib';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import * as rds from 'aws-cdk-lib/aws-rds';
import { Duration, RemovalPolicy, Stack, StackProps } from "aws-cdk-lib";
import {
  InstanceClass,
  InstanceSize,
  InstanceType,
  Peer,
  Port,
  SecurityGroup,
  SubnetType,
  Vpc,
} from "aws-cdk-lib/aws-ec2";
import { Credentials, DatabaseInstance, DatabaseInstanceEngine, PostgresEngineVersion } from "aws-cdk-lib/aws-rds";
import { Secret } from "aws-cdk-lib/aws-secretsmanager";


export class CdkprojectStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
    // Create VPC
    const vpc = new ec2.Vpc(this, 'MyVpc', {
      ipAddresses: ec2.IpAddresses.cidr('10.20.0.0/16'),
      maxAzs: 2,
      natGateways: 1,
      subnetConfiguration: [
        {
          subnetType: ec2.SubnetType.PUBLIC,
          name: 'Public',
          cidrMask: 24,
        },
      
        {
          cidrMask: 24,
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },

      ],      
      
    });

    //Create a New Keypair
    const cfnKeyPair = new ec2.CfnKeyPair(this, 'MyCfnKeyPair', {
      keyName: 'kpcdkmajid',
    });
    
    //Security Group for EC2 allowing port 80 and 22
    const securityGroup = new ec2.SecurityGroup(
      this,
      'allow-http-ssh-sg',
      {
        vpc: vpc,
        allowAllOutbound: true, // will let your instance send outboud traffic
        securityGroupName: 'allow-http-ssh-sg',
      }
    ) 
    
    securityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(22),
      'Allows SSH access from Internet'
    )

    securityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      'Allows HTTP access from Internet'
    )

    //Security Group for ALB allowing Port 80
    const ALBsecurityGroup = new ec2.SecurityGroup(
      this,
      'allow-http',
      {
        vpc: vpc,
        allowAllOutbound: true, // will let your instance send outboud traffic
        securityGroupName: 'allow-http',
      }
    ) 

    ALBsecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      'Allows HTTP access from Internet'
    )
    
    //Security Group for RDS MySQL-- Allow Port 3306
    const RDSsecurityGroup = new ec2.SecurityGroup(
      this,
      'allow-SQL',
      {
        vpc: vpc,
        allowAllOutbound: true, // will let your instance send outboud traffic
        securityGroupName: 'allow-SQL',
      }
    ) 

    RDSsecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(3306),
      'Allows on SQL Port'
    )      
    
    
    //Create EC2 in public Subnet
    const instance1 = new ec2.Instance(this, 'public-EC2', {
      vpc: vpc,
      securityGroup: securityGroup,
      instanceName: 'public-EC2',
      instanceType: ec2.InstanceType.of( // t2.micro has free tier usage in aws
        ec2.InstanceClass.T2,
        ec2.InstanceSize.MICRO
      ),
      machineImage: ec2.MachineImage.latestAmazonLinux({
        generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2,
      }),

      keyName: 'kpcdkmajid',
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
      associatePublicIpAddress: true,
      
    })
    
    //Create EC2 in a private Subnet
    const instance2 = new ec2.Instance(this, 'private-EC2', {
      vpc: vpc,
      securityGroup: securityGroup,
      instanceName: 'private-EC2',
      instanceType: ec2.InstanceType.of( // t2.micro has free tier usage in aws
        ec2.InstanceClass.T2,
        ec2.InstanceSize.MICRO
      ),
      machineImage: ec2.MachineImage.latestAmazonLinux({
        generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2,
      }),

      keyName: 'kpcdkmajid',
      associatePublicIpAddress: false,
      
    })
    
    //ALB Target Group
    const targetGroup1 = new elbv2.ApplicationTargetGroup(this, 'TargetGroup', {
      port: 80,
      targetType: elbv2.TargetType.INSTANCE,
      targetGroupName: 'target',
      deregistrationDelay: cdk.Duration.seconds(45),
      healthCheck: {
        interval: cdk.Duration.seconds(15),
        path: '/',
        timeout: cdk.Duration.seconds(5)
      },
      vpc: vpc,
    });
    
    //Auto Scaling Group
    const asg = new autoscaling.AutoScalingGroup(this, 'ASG', {
      vpc,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T2, ec2.InstanceSize.MICRO),
      machineImage: new ec2.AmazonLinuxImage(),
      vpcSubnets: vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS }),
    });
    
    //Application Load Balancer and Listener
    const alb = new elbv2.ApplicationLoadBalancer(this, 'ALB', {
      vpc,
      internetFacing: true,
      vpcSubnets: vpc.selectSubnets({ subnetType: ec2.SubnetType.PUBLIC }),
    });
    
    const listener = alb.addListener('WebListener', {
      port: 80,
    });
    
    listener.addTargets('Target', {
      port: 80,
      targets: [asg]
    });
    
    listener.connections.allowDefaultPortFromAnyIpv4('Open to the world'); 
    
    
    //Create RDS
    
   const engine = DatabaseInstanceEngine.mysql({ version: rds.MysqlEngineVersion.VER_8_0_34 });
   const instanceType = InstanceType.of(InstanceClass.T2, InstanceSize.MICRO);
 
    // create database master user secret and store it in Secrets Manager
    const masterUserSecret = new Secret(this, "db-master-user-secret", {
      secretName: "db-master-user-secret",
      description: "Database master user credentials",
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: "admin" }),
        generateStringKey: "password",
        passwordLength: 16,
        excludePunctuation: true,
      },
    });

    // create RDS instance (PostgreSQL)
    // Subnet Group will be created automatically by CDK
    const dbInstance = new DatabaseInstance(this, "MySQL", {
      databaseName: 'cdkproject',
      vpc: vpc,
      vpcSubnets: { subnetType: SubnetType.PRIVATE_WITH_EGRESS },
      instanceType,
      engine,
      securityGroups: [RDSsecurityGroup],
      credentials: Credentials.fromSecret(masterUserSecret),
      backupRetention: Duration.days(0), // disable automatic DB snapshot retention
      deleteAutomatedBackups: true,
      removalPolicy: RemovalPolicy.DESTROY,
    });

  }
}
