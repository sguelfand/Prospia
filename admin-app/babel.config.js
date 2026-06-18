module.exports = function (api) {
  api.cache(true);
  return {
    presets: ["babel-preset-expo"],
    // Reanimated v4 usa el plugin de worklets; tiene que ir ÚLTIMO en la lista.
    // Lo necesita @react-navigation/drawer para las animaciones del menú lateral.
    plugins: ["react-native-worklets/plugin"],
  };
};
