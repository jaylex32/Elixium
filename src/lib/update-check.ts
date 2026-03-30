import pc from 'picocolors';
import {UPDATE_STATUS_MESSAGE} from '../app/brand';
import {terminalRule} from '../app/terminal';

const updateCheck = async (pkg: any) => {
  try {
    process.on('exit', () => {
      const rule = terminalRule(46);
      console.log(`${rule}\n${pc.cyanBright(`     ${UPDATE_STATUS_MESSAGE}`)}\n${rule}`);
    });
    return null;
  } catch (err) {
    return null;
  }
};

export default updateCheck;
