const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

config.resolver.assetExts.push('onnx');
config.resolver.assetExts.push('db');
config.resolver.assetExts.push('csv'); // Fix hashes loading

module.exports = config;