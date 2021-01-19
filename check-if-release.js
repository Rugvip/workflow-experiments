const { execFile: execFileCb } = require('child_process');
const { resolve: resolvePath } = require('path');
const { promises: fs } = require('fs');
const { promisify } = require('util');

const parentRef = process.env.COMMIT_SHA_BEFORE || 'HEAD^';
console.log('DEBUG: parentRef =', parentRef)

const execFile = promisify(execFileCb);

async function runPlain(cmd, ...args) {
  try {
    const { stdout } = await execFile(cmd, args, { shell: true });
    return stdout.trim();
  } catch (error) {
    if (error.stderr) {
      process.stderr.write(error.stderr);
    }
    if (!error.code) {
      throw error;
    }
    throw new Error(
      `Command '${[cmd, ...args].join(' ')}' failed with code ${error.code}`,
    );
  }
}

async function main() {
  process.cwd(resolvePath(__dirname, '..'));

  const diff = await runPlain(
    'git',
    'diff',
    '--name-only',
    parentRef,
    "'packages/*/package.json'",
  );
  console.log('DEBUG: diff =', diff);
  const packageList = diff.split(/^(.*)$/gm).filter(s => s.trim());

  const packageVersions = await Promise.all(
    packageList.map(async path => {
      const { name, version: oldVersion } = JSON.parse(
        await fs.readFile(path, 'utf8'),
      );
      const { version: newVersion } = JSON.parse(
        await runPlain('git', 'show', `${parentRef}:${path}`),
      );
      return { name, oldVersion, newVersion };
    }),
  );

  const newVersions = packageVersions.filter(
    ({ oldVersion, newVersion }) => oldVersion !== newVersion,
  );

  if (newVersions.length === 0) {
    console.log('No package version bumps detected, no release needed');
    console.log(`::set-output name=needs_release::false`);
    return;
  }

  console.log('Package version bumps detected, a new release is needed');
  const maxLength = Math.max(...newVersions.map(_ => _.name.length));
  for (const { name, oldVersion, newVersion } of newVersions) {
    console.log(
      `  ${name.padEnd(maxLength, ' ')} ${oldVersion} -> ${newVersion}`,
    );
  }
  console.log(`::set-output name=needs_release::true`);
}

main().catch(error => {
  console.error(error.stack);
  process.exit(1);
});
