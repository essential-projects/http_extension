'use strict';

const HttpExtension = require('./dist/commonjs/index').HttpExtension;
const extensionDiscoveryTag = require('@process-engine-js/core_contracts').ExtensionDiscoveryTag;

function registerInContainer(container) {

  container.register('HttpExtension', HttpExtension)
    .dependencies('container', 'MessageBusAdapter', 'IamService')
    .configure('http:http_extension')
    .tags(extensionDiscoveryTag)
    .singleton();
}

module.exports.registerInContainer = registerInContainer;
