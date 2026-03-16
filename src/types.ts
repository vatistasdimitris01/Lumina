export interface UserProfile {
  uid: string;
  username: string;
  displayName: string;
  photoURL: string;
  createdAt: any;
}

export interface Chat {
  id: string;
  participants: string[];
  lastMessage?: string;
  lastMessageTime?: any;
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
