import {
  createUserWithEmailAndPassword as firebaseCreateUserWithEmailAndPassword,
  getAuth,
  onAuthStateChanged,
  signInWithEmailAndPassword as firebaseSignInWithEmailAndPassword,
} from '@react-native-firebase/auth';
import type { User } from '@react-native-firebase/auth';

const auth = getAuth();

export function observeAuthState(
  onUserChanged: (user: User | null) => void,
): () => void {
  return onAuthStateChanged(auth, onUserChanged);
}

export function signInWithEmailAndPassword(email: string, password: string) {
  return firebaseSignInWithEmailAndPassword(auth, email, password);
}

export function createUserWithEmailAndPassword(email: string, password: string) {
  return firebaseCreateUserWithEmailAndPassword(auth, email, password);
}
