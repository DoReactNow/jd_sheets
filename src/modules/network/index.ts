// Public API of the network module.
export {
  networkService,
  requestIp,
  setNetworkEnforcementForTests,
  type RuleDto,
} from "./network.service";
export { parseCidr, cidrContains } from "./network.cidr";
