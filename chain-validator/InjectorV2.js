const Eos = require('eosjs');
const fs = require('fs');
const async = require('async');
const mongoose = require('mongoose'),
    Schema = mongoose.Schema;
Promise = require('bluebird');
mongoose.Promise = Promise;

const config = {
    keyProvider: [""],
    httpEndpoint: 'http://127.0.0.1:8888',
    expireInSeconds: 3600,
    broadcast: false,
    debug: false,
    sign: true,
    chainId: '0d6c11e66db1ea0668d630330aaee689aa6aa156a27d39419b64b5ad81c0a760'
};
const eos = Eos(config);

const TokenHolderSchema = new Schema({
    eth: {type: String, unique: true},
    acc: {type: String, unique: true},
    eos: {type: String},
    bal: String,
    proof: Schema.Types.Mixed,
    created: Boolean,
    balanceValid: Boolean,
    stakedBalance: Number,
    freeBalance: Number,
    creationBlock: String
});
const TokenHolder = mongoose.model('tokenholder', TokenHolderSchema);

let systemContract = null;
const ProgressBar = require('progress');
let bar = null;

function run() {
    TokenHolder.find({"created":false}).count().then((total_tokenholders) => {
        console.log("Total accounts in database: " + total_tokenholders);
        bar = new ProgressBar(' >> Injecting accounts [:current/:total] [:bar] :rate accounts/s :percent :etas', {
            complete: '=',
            incomplete: ' ',
            width: 50,
            total: total_tokenholders
        });
        process_accounts();
    });
}

let accountMap = null;

function process_accounts() {
    TokenHolder.find({"created":false}).then((accounts) => {
        accountMap = accounts;
        popActions();
    });
}

function popActions() {
    const tempArray = [];
    while (accountMap.length > 0 && tempArray.length < 2) {
        const newAccount = accountMap.pop();
        tempArray.push(newAccount);
    }
    if (accountMap.length > 0 && tempArray.length > 0) {
        bar.tick(tempArray.length, {});
        // Prepare transaction block
        eos['transaction'](['eosio', 'eosio.token'], ({eosio, eosio_token}) => {
            tempArray.forEach((account) => {
                let floatingAmount = 0;
                if (account.bal > 11) {
                    floatingAmount = 10;
                } else if (account.bal > 3) {
                    floatingAmount = 2;
                } else {
                    floatingAmount = 0.1;
                }
                let split_cpu, split_net;
                let split = (account.bal - floatingAmount) / 2;
                split_cpu = split.toFixed(4);
                split_net = (split * 2) - split_cpu;
                console.log(account.bal, floatingAmount, split_cpu, split_net);
                if (split_net < 0.0001) {
                    console.log(account.bal, floatingAmount, split_cpu, split_net);
                    process.exit(1);
                }
                eosio.newaccount('eosio', account.acc, account.eos, account.eos);
                eosio.buyrambytes('eosio', account.acc, 8192);
                eosio.delegatebw('eosio', account.acc, split_net.toFixed(4) + ' EOS', split_cpu + ' EOS', 1);
                eosio_token.transfer('eosio', account.acc, floatingAmount + ' EOS', 'init');
            });
        }).then(() => {
            popActions();
        });

    } else {
        console.log("Injection Finished!");
        resetChainParams();
    }
}

const newParams = {
    "max_block_net_usage": 1048576,
    "target_block_net_usage_pct": 1000,
    "max_transaction_net_usage": 524288,
    "base_per_transaction_net_usage": 12,
    "net_usage_leeway": 500,
    "context_free_discount_net_usage_num": 20,
    "context_free_discount_net_usage_den": 100,
    "max_block_cpu_usage": 100000000,
    "target_block_cpu_usage_pct": 1000,
    "max_transaction_cpu_usage": 99999899,
    "min_transaction_cpu_usage": 100,
    "max_transaction_lifetime": 3600,
    "deferred_trx_expiration_window": 600,
    "max_transaction_delay": 3888000,
    "max_inline_action_size": 4096,
    "max_inline_action_depth": 4,
    "max_authority_depth": 6
};

const stdParams = {
    "max_block_net_usage": 1048576,
    "target_block_net_usage_pct": 1000,
    "max_transaction_net_usage": 524288,
    "base_per_transaction_net_usage": 12,
    "net_usage_leeway": 500,
    "context_free_discount_net_usage_num": 20,
    "context_free_discount_net_usage_den": 100,
    "max_block_cpu_usage": 200000,
    "target_block_cpu_usage_pct": 1000,
    "max_transaction_cpu_usage": 150000,
    "min_transaction_cpu_usage": 100,
    "max_transaction_lifetime": 3600,
    "deferred_trx_expiration_window": 600,
    "max_transaction_delay": 3888000,
    "max_inline_action_size": 4096,
    "max_inline_action_depth": 4,
    "max_authority_depth": 6
};

function resetChainParams() {
    systemContract['setparams']({params: stdParams}, {
        broadcast: true,
        sign: true,
        authorization: [{
            actor: 'eosio',
            permission: 'active'
        }]
    }).then((data) => {
        console.log(data);
        console.log('Token Injection Complete!');
        process.exit(1);
    });
}

mongoose.connect('mongodb://localhost/mainnet').then(() => {

    eos['getInfo']({}).then(result => {
        if ((result.head_block_num - result.last_irreversible_block_num) < 10) {
            eos['contract']('eosio').then(system => {
                systemContract = system;
            }).then(() => {

                systemContract['setparams']({params: newParams}, {
                    broadcast: true,
                    sign: true,
                    authorization: [{
                        actor: 'eosio',
                        permission: 'active'
                    }]
                }).then((data) => {
                    console.log(data);
                    run();
                });
            });
        }
    });
});
