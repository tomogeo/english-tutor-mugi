import TutorView from './ui/TutorView';
import { PairBanner } from './ui/PairBanner';

/** The app is the 英語家教 screen alone: no menu, so there is no way back (TutorView's onBack is optional). */
export default function App() {
  return <><TutorView /><PairBanner /></>;
}
