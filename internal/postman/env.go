package postman

import (
	"fmt"
	"strings"
)

// The environment mapper: a Postman environment file → ONE new environment
// (named from the file, deduplicated "(2)"; never merged into an existing one).
//
//	type "secret"        → a secret variable: key only, the value is NOT imported
//	                       (secret values never reach the server; reported)
//	any other type       → a regular variable with its value
//	disabled in Postman  → imported enabled (Ghostman has no disabled variables; reported)
//	no key / repeated key → not imported (reported; the first of a repeated key wins)

// VariablePlan is a variable to create.
type VariablePlan struct {
	Key    string
	Secret bool
	Value  string // regular variables only
}

// EnvironmentPlan is everything an environment import will create.
type EnvironmentPlan struct {
	Report    *Report
	Name      string // the (deduplicated) environment name to create
	Variables []VariablePlan
}

// Variable types (the server's).
const (
	VarRegular = "regular"
	VarSecret  = "secret"
)

// PlanEnvironment maps a Postman environment. existingEnvs are the project's
// environment names (for the "(2)" dedupe).
func PlanEnvironment(data []byte, source string, existingEnvs []string) (*EnvironmentPlan, error) {
	e, err := parseEnvironment(data)
	if err != nil {
		return nil, err
	}
	format := "Environment"
	if e.Scope == "globals" {
		format = "Globals"
	}
	rep := newReport(KindEnvironment, source, format, e.Name)
	fileName := strings.TrimSpace(e.Name)
	if fileName == "" {
		fileName = "Imported environment"
	}
	name := UniqueName(fileName, existingEnvs)
	label := fmt.Sprintf("Env '%s'", fileName)
	if e.Scope == "globals" {
		rep.add(warn(CodeEnvGlobals, label, "a Postman globals file, imported as an ordinary environment.",
			"Select it in the environment switcher to use the values."))
	}

	plan := &EnvironmentPlan{Report: rep, Name: name}
	seen := map[string]bool{}
	var secrets, keyless, dupes []string
	for _, v := range e.Values {
		key := strings.TrimSpace(string(v.Key))
		switch {
		case key == "":
			keyless = append(keyless, string(v.Value))
			continue
		case seen[key]:
			dupes = append(dupes, fmt.Sprintf("%s = %s", key, v.Value))
			continue
		}
		seen[key] = true
		vp := VariablePlan{Key: key}
		if strings.EqualFold(v.Type, VarSecret) {
			vp.Secret = true
			secrets = append(secrets, key)
		} else {
			vp.Value = string(v.Value)
		}
		if (v.Enabled != nil && !*v.Enabled) || v.Disabled {
			rep.add(warn(CodeEnvDisabled, label,
				fmt.Sprintf("variable '%s' was disabled in Postman; imported enabled (Ghostman has no disabled variables).", key),
				"Delete it if it should not be used."))
		}
		plan.Variables = append(plan.Variables, vp)
	}
	if len(secrets) > 0 {
		e := warn(CodeEnvSecret, label,
			plural(len(secrets), "secret variable", "secret variables")+" imported WITHOUT values (Ghostman never syncs secret values).",
			fmt.Sprintf("Set %s in Manage environments → %s.", itThem(len(secrets)), name))
		e.Detail, e.DetailLabel = strings.Join(secrets, "\n"), "Secret variables"
		rep.add(e)
	}
	if len(keyless) > 0 {
		e := drop(CodeEnvKeyless, label, plural(len(keyless), "variable without a name", "variables without a name")+
			" not imported.", "")
		e.Detail, e.DetailLabel = strings.Join(keyless, "\n"), "Values"
		rep.add(e)
	}
	if len(dupes) > 0 {
		e := drop(CodeEnvDuplicate, label, plural(len(dupes), "repeated variable", "repeated variables")+
			" not imported: a key can appear once per environment, and the first one was imported.", "")
		e.Detail, e.DetailLabel = strings.Join(dupes, "\n"), "Not imported"
		rep.add(e)
	}
	return plan, nil
}

func itThem(n int) string {
	if n == 1 {
		return "it"
	}
	return "them"
}
