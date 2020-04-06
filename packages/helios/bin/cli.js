#!/usr/bin/env node

const { RuntimeApi } = require('@joystream/runtime-api');
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


  const downProviders = storageProviderAccountInfos.filter(({account, info}) => {
    return info == null
  });

  const expiredTtlProviders = storageProviderAccountInfos.filter(({account, info}) => {
    return info && currentHeight.gte(info.expires_at)
  });


  let expiredProviderStatuses = mapInfoToStatus(expiredTtlProviders, currentHeight)
  console.log('\n== Expired Providers\n', expiredProviderStatuses);

  // check when actor account was created consider grace period before removing
  console.log('\n== Down Providers!\n', downProviders.map(provider => {
    return ({
      account: provider.account.toString(),
      age: currentHeight.sub(provider.joined).toNumber()
    })
  }));


  // after resolving for each resolved provider, HTTP HEAD with axios all known content ids
  // report available/known
  // interesting disconnect doesn't work unless an explicit provider was created
  // for underlying api instance
  runtime.api.disconnect();
})();

function mapInfoToStatus(providers, currentHeight) {
  return providers.map(({account, info, joined}) => {
    if (info) {
      return {
        address: account.toString(),
        age: currentHeight.sub(joined).toNumber(),
        identity: info.identity.toString(),
        expiresIn: info.expires_at.sub(currentHeight).toNumber(),
        expired: currentHeight.gte(info.expires_at),
      }
    } else {
      return {
        address: account.toString(),
        identity: null,
        status: 'down'
      }
    }
  })
}


