#!/usr/bin/env node

const { RuntimeApi } = require('@joystream/runtime-api');
const { encodeAddress } = require('@polkadot/keyring')
const { discover } = require('@joystream/discovery');
const axios = require('axios');
const stripEndingSlash = require('@joystream/util/stripEndingSlash');

(async function main () {

  const runtime = await RuntimeApi.create();
  const api  = runtime.api;

  // get current blockheight
  const currentHeader = await api.rpc.chain.getHeader();
  const currentHeight = currentHeader.number.toBn();

  // get all providers
  const storageProviders = await api.query.actors.accountIdsByRole(0);

  const storageProviderAccountInfos = await Promise.all(storageProviders.map(async (account) => {
    return ({
      account,
      info: await runtime.discovery.getAccountInfo(account),
      joined: (await api.query.actors.actorByAccountId(account)).unwrap().joined_at
    });
  }));

  const liveProviders = storageProviderAccountInfos.filter(({account, info}) => {
    return info && info.expires_at.gte(currentHeight)
  });

  const downProviders = storageProviderAccountInfos.filter(({account, info}) => {
    return info == null
  });

  const expiredTtlProviders = storageProviderAccountInfos.filter(({account, info}) => {
    return info && currentHeight.gte(info.expires_at)
  });

  let providersStatuses = mapInfoToStatus(liveProviders, currentHeight);
  console.log('\n== Live Providers\n', providersStatuses);

  let expiredProviderStatuses = mapInfoToStatus(expiredTtlProviders, currentHeight)
  console.log('\n== Expired Providers\n', expiredProviderStatuses);

  // check when actor account was created consider grace period before removing
  console.log('\n== Down Providers!\n', downProviders.map(provider => {
    return ({
      account: provider.account.toString(),
      age: currentHeight.sub(provider.joined).toNumber()
    })
  }));

  // Resolve IPNS identities of providers
  console.log('\nResolving live provider API Endpoints...')
  //providersStatuses = providersStatuses.concat(expiredProviderStatuses);
  let endpoints = await Promise.all(providersStatuses.map(async (status) => {
    try {
      let serviceInfo = await discover.discover_over_joystream_discovery_service(status.address, runtime);
      let info = JSON.parse(serviceInfo.serialized);
      console.log(`${status.address} -> ${info.asset.endpoint}`);
      return { address: status.address, endpoint: info.asset.endpoint};
    } catch (err) {
      console.log('resolve failed', status.address, err.message);
      return { address: status.address, endpoint: null};
    }
  }));

  console.log('\nChecking API Endpoint is online')
  await Promise.all(endpoints.map(async (provider) => {
    if (!provider.endpoint) {
      console.log('skipping', provider.address);
      return
    }
    const swaggerUrl = `${stripEndingSlash(provider.endpoint)}/swagger.json`;
    let error;
    try {
      await axios.get(swaggerUrl)
    } catch (err) {error = err}
    console.log(`${provider.endpoint} - ${error ? error.message : 'OK'}`);
  }));

  // after resolving for each resolved provider, HTTP HEAD with axios all known content ids
  // report available/known
  let knownContentIds = await runtime.assets.getKnownContentIds()

  console.log(`\nContent Directory has ${knownContentIds.length} assets`);

  await Promise.all(knownContentIds.map(async (contentId) => {
    let [relationships, judgement] = await assetRelationshipState(api, contentId, storageProviders);
    console.log(`${encodeAddress(contentId)} replication ${relationships}/${storageProviders.length} - ${judgement}`);
  }));
