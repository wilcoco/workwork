export type GraphTeamworkActivityTopic = {
  source: 'entityUrl' | 'text';
  value: string;
  webUrl?: string;
};

export type GraphAadUserNotificationRecipient = {
  '@odata.type': 'microsoft.graph.aadUserNotificationRecipient' | '#microsoft.graph.aadUserNotificationRecipient';
  userId: string;
};

export type GraphSendActivityNotificationRequestBody = {
  topic: GraphTeamworkActivityTopic;
  activityType: string;
  previewText: { content: string };
  recipient: GraphAadUserNotificationRecipient;
  templateParameters?: Array<{ name: string; value: string }>;
};
