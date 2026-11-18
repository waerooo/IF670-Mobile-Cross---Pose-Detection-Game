module.exports = {
  presets: ['module:@react-native/babel-preset'],
  plugins: [
    // Required for react-native-worklets-core (used by VisionCamera Frame Processors)
    'react-native-worklets-core/plugin',
  ],
};
