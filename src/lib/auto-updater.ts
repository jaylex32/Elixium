import signale from './signale';
import {UPDATE_STATUS_MESSAGE} from '../app/brand';

const updateBinary = async (_pkg: any) => {
  console.log(signale.info(UPDATE_STATUS_MESSAGE));
};

export default updateBinary;
