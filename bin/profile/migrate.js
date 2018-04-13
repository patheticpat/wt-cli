var Chalk = require('chalk');
var Cli = require('structured-cli');
var ConfigFile = require('../../lib/config');
var PrintProfile = require('../../lib/printProfile');
var _ = require('lodash');
var node4Migration = require('../../lib/node4Migration');
var Async = require('async');
var Sandbox = require('sandboxjs');



module.exports = Cli.createCommand('migrate', {
    description: 'Migrate Node 4 webtasks to Node 8',
    handler: handleProfileMigrate,
    optionGroups: {
        'Migration options': {
            include: {
                alias: 'i',
                action: 'append',
                defaultValue: [],
                description: 'Webtasks to include in the migration (all if not specified)',
                dest: 'include',
                type: 'string',
            },
            exclude: {
                alias: 'x',
                action: 'append',
                defaultValue: [],
                description: 'Webtasks to exclude from migration',
                dest: 'exclude',
                type: 'string',
            },
            force: {
                alias: 'f',
                description: 'Force override of existing Node 8 webtasks',
                type: 'boolean',
            },
            yes: {
                alias: 'y',
                description: 'Perform actual migration instead of a simulation',
                type: 'boolean',
            }
        },
    },
    params: {
        'profile': {
            description: 'Profile to migrate',
            type: 'string',
        },
    },
});


// Command handler

function handleProfileMigrate(args) {
    var config = new ConfigFile();

    global.preventMigrationNotice = true;

    return config.getProfile(args.profile)
        .then(function (profile) {
            if (!node4Migration.isNode4Profile(profile)) {
                throw new Cli.error.invalid(Chalk.red(`This profile is not a Node 4 webtask.io profile and cannot be migrated.`));
            }

            return new Promise((resolve, reject) => {
                return Async.waterfall([
                    (cb) => getWebtasks({}, profile.url, 'node4', cb),
                    (tx, cb) => getWebtasks(tx, node4Migration.node8BaseUrl, 'node8', cb),
                    (tx, cb) => filterOut(tx, cb),
                    (tx, cb) => migrate(tx, cb),
                ], error => error ? reject(error) : resolve());
            });

            function migrate(tx, cb) {
                if (tx.node4.length === 0) {
                    console.log(Chalk.yellow('There are no matching webtasks to migrate.'));
                    return cb();
                }
                tx.node4.sort();
                console.log('Your webtasks:\n')
                return Async.eachSeries(tx.node4, (w, cb) => {
                    var performMigration = true;
                    if (tx.node8.indexOf(w) > -1) {
                        if (args.force) {
                            console.log(Chalk.blue(`${w}:`), Chalk.yellow(`overriding existing Node 8 webtask...`));
                        }
                        else {
                            performMigration = false;
                            console.log(Chalk.blue(`${w}:`), Chalk.yellow(`Node 8 webtask already exists, skipping.`));
                        }
                    }
                    else {
                        console.log(Chalk.blue(`${w}:`), Chalk.green(`migrating...`));
                    }

                    if (performMigration && args.yes) {
                        return node4Migration.migrate({ 
                            containerName: profile.container,
                            webtaskName: w,
                            token: profile.token
                        }, (e,m) => {
                            var warnings;
                            if (Array.isArray(m)) {
                                m.forEach(w => warnings = warnings ? `${warnings}\n* ${w}` : `* ${w}`);
                            }
                            if (e) {
                                console.log(Chalk.red(`...Error: ${e.message}`));
                                if (warnings) console.log(Chalk.red(warnings));
                            }
                            else if (warnings) {
                                console.log(Chalk.yellow(`...Succeeded with warnings:\n${warnings}`));
                            }
                            else {
                                console.log(Chalk.green(`...Success`));
                            }
                            return cb();
                        });
                    }
                    else {
                        return cb();
                    }
                }, (e) => {
                    if (e) return cb(e);
                    console.log();
                    if (!args.yes) {
                        console.log(Chalk.yellow('This is simulation, no changes were made. To perform actual migration to Node 8, specify the --yes switch.'));
                    }
                    console.log('To complete the migration to Node 8, please see further migration instructions at https://github.com/auth0/wt-cli/wiki/Node8.')
                    cb();
                });
            }

            function filterOut(tx, cb) {
                if (args.include.length > 0) {
                    var includes = [];
                    args.include.forEach(i => {
                        if (tx.node4.indexOf(i) > -1) {
                            includes.push(i);
                        }
                    });
                    tx.node4 = includes;
                }
                args.exclude.forEach(e => {
                    var i = tx.node4.indexOf(i);
                    if (i > -1) {
                        tx.node4.splice(i, 1);
                    }
                });
                cb(null, tx);
            }

            function getWebtasks(tx, url, name, cb) {

                tx[name] = [];
                var p = Sandbox.init({
                    url,
                    container: profile.container,
                    token: profile.token
                });

                return appendMoreWebtasks();

                function appendMoreWebtasks() {
                    p.listWebtasks({ 
                        offset: tx[name].length, 
                        limit: 100 
                    }, (e, d) => {
                        if (e) return cb(e);
                        if (!d || d.length === 0) return cb(null, tx);
                        d.forEach(w => tx[name].push(w.toJSON().name));
                        appendMoreWebtasks();
                    });
                }
            }
        });
}

