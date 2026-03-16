export interface UserProfile {
  uid: string;
  username: string;
  displayName: string;
  photoURL: string;
  createdAt: any;
}

export interface Message {
  id: string;
  senderId: string;
  senderUsername: string;
  text?: string;
  fileUrl?: string;
  fileType?: string;
  fileName?: string;
  createdAt: any;
  isPending?: boolean;
}
