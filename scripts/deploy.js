'use strict';

const { execFileSync } = require('child_process');
const ghpages = require('gh-pages');

function actionsToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  try {
    const config = execFileSync('git', ['config', '--local', '--get-regexp', '^http\\..*\\.extraheader$'], { encoding: 'utf8' });
    const basic = config.match(/AUTHORIZATION:\s*basic\s+(\S+)/i)?.[1];
    const credentials = basic && Buffer.from(basic, 'base64').toString();
    return credentials?.slice(credentials.indexOf(':') + 1) || '';
  } catch {
    return '';
  }
}

const options = { dotfiles: true };
if (process.env.GITHUB_ACTIONS) {
  const token = actionsToken();
  if (!token) throw new Error('GitHub Actions checkout credentials were not found.');
  options.repo = `https://x-access-token:${token}@github.com/aaronik/land.git`;
  options.user = {
    name: 'github-actions[bot]',
    email: '41898282+github-actions[bot]@users.noreply.github.com'
  };
}

ghpages.publish('build', options, error => {
  if (error) {
    console.error(error.stack || error);
    process.exitCode = 1;
  } else {
    console.log('Published build to gh-pages.');
  }
});
