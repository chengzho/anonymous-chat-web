import { useState } from 'react';
import WelcomeScreen from './components/WelcomeScreen';
import ChatScreen from './components/ChatScreen';

type Screen = 'welcome' | 'chat';

interface ChatCredentials {
  callsign: string;
  passcode: string;
}

export default function App() {
  const [screen, setScreen] = useState<Screen>('welcome');
  const [credentials, setCredentials] = useState<ChatCredentials | null>(null);

  const handleEnterChat = (callsign: string, passcode: string) => {
    setCredentials({ callsign, passcode });
    setScreen('chat');
  };

  const handleLeaveChat = () => {
    setCredentials(null);
    setScreen('welcome');
  };

  if (screen === 'chat' && credentials) {
    return (
      <ChatScreen
        callsign={credentials.callsign}
        passcode={credentials.passcode}
        onDisconnect={handleLeaveChat}
      />
    );
  }

  return <WelcomeScreen onEnterChat={handleEnterChat} />;
}
