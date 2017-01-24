'use strict';

const HttpExtension = require('./dist/commonjs/index').HttpExtension;
const extensionDiscoveryTag = require('@5minds/bootstrapper').extensionDiscoveryTag;

function registerInContainer(container) {

  container.register('HttpExtension', HttpExtension)
    .dependencies('container', 'FayeClient', 'IamService')
    .configure('http:http_extension')
    .tags(extensionDiscoveryTag);
}

module.exports.registerInContainer = registerInContainer;
