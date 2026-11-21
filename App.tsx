import React from 'react';
import { ActivityIndicator, StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { User } from '@react-native-firebase/auth';
import { COLORS } from './src/constants';
import GameScreen from './src/screens/GameScreen';
import HomeScreen from './src/screens/HomeScreen';
import LoginScreen from './src/screens/LoginScreen';
import ProfileScreen from './src/screens/ProfileScreen';
import RegisterScreen from './src/screens/RegisterScreen';
import { observeAuthState } from './src/services/firebase/authService';

type SignedInScreen = 'menu' | 'profile' | 'game';

function App() {
  const [user, setUser] = React.useState<User | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [showRegistration, setShowRegistration] = React.useState(false);
  const [signedInScreen, setSignedInScreen] = React.useState<SignedInScreen>('menu');

  React.useEffect(() => {
    return observeAuthState(authenticatedUser => {
      setUser(authenticatedUser);
      if (!authenticatedUser) {
        setSignedInScreen('menu');
        setShowRegistration(false);
      }
      setIsLoading(false);
    });
  }, []);

  return (
    <SafeAreaProvider>
      <StatusBar barStyle="light-content" />
      {isLoading ? (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={COLORS.primary} />
        </View>
      ) : user && signedInScreen === 'profile' ? (
        <ProfileScreen
          userId={user.uid}
          email={user.email ?? ''}
          onBack={() => setSignedInScreen('menu')}
        />
      ) : user && signedInScreen === 'game' ? (
        <GameScreen
          userId={user.uid}
          onBackToMenu={() => setSignedInScreen('menu')}
        />
      ) : user ? (
        <HomeScreen
          email={user.email ?? ''}
          onOpenProfile={() => setSignedInScreen('profile')}
          onStartGame={() => setSignedInScreen('game')}
        />
      ) : showRegistration ? (
        <RegisterScreen onPressLogin={() => setShowRegistration(false)} />
      ) : (
        <LoginScreen onPressRegister={() => setShowRegistration(true)} />
      )}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.background,
  },
});

export default App;
