import React from 'react';
import { ActivityIndicator, StatusBar, StyleSheet, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import type { User } from '@react-native-firebase/auth';
import { COLORS } from './src/constants';
import GameScreen from './src/screens/GameScreen';
import LoginScreen from './src/screens/LoginScreen';
import RegisterScreen from './src/screens/RegisterScreen';
import { observeAuthState } from './src/services/firebase/authService';

function App() {
  const [user, setUser] = React.useState<User | null>(null);
  const [isLoading, setIsLoading] = React.useState(true);
  const [showRegistration, setShowRegistration] = React.useState(false);

  React.useEffect(() => {
    return observeAuthState(authenticatedUser => {
      setUser(authenticatedUser);
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
      ) : user ? (
        <GameScreen userId={user.uid} />
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
