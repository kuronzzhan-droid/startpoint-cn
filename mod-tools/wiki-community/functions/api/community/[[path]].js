import {handleCommunity} from '../../../handler.mjs';
export const onRequest = ({request, env}) => handleCommunity(request, env);
