// The real bindings behind tooltip editing (see vars.ts saveFromTooltip /
// createFromTooltip): the same bound methods the env tab uses, then a refresh of
// the env store so highlighting and hovers update.
import { CreateVariable, SetVariableValue } from "../wailsjs/go/main/App";
import { handleProblem } from "./authStore";
import { refreshEnvContext } from "./envStore";
import { VarEditApi } from "./vars";

export const varEditApi: VarEditApi = {
  setValue: async (envId, varId, value) => {
    const res = await SetVariableValue(envId, varId, value);
    handleProblem(res.error);
    return res;
  },
  create: async (envId, key, type) => {
    const res = await CreateVariable(envId, key, type);
    handleProblem(res.error);
    return res;
  },
  refresh: () => refreshEnvContext(),
};
