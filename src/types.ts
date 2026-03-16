export interface UserProfile {
  uid: string;
  username: string;
  displayName: string;
  photoURL: string;
  createdAt: any;
}

export interface FriendProfile extends UserProfile {
  relationshipId: string;
  status: 'pending' | 'accepted';
  initiator: string;
}

export interface Chat {
  id: string;
  participants: string[];
  lastMessage?: string;
  lastMessageTime?: any;
  createdAt: any;
  status?: 'pending' | 'accepted';
  initiator?: string;
}

export interface Message {
  id: string;
  senderId: string;
  senderUsername: string;
  text?: string;
  createdAt: any;
  isPending?: boolean;
}
