import {
  confirm as inquirerConfirm,
  input as inquirerInput,
  select as inquirerSelect,
} from "@inquirer/prompts";

export interface PromptAdapter {
  input(message: string): Promise<string>;
  select<T>(message: string, choices: Array<{ name: string; value: T }>): Promise<T>;
  confirm(message: string, defaultValue?: boolean): Promise<boolean>;
}

export const defaultPromptAdapter: PromptAdapter = {
  input(message) {
    return inquirerInput({ message });
  },
  select<T>(message: string, choices: Array<{ name: string; value: T }>): Promise<T> {
    return inquirerSelect<T>({ message, choices });
  },
  confirm(message, defaultValue = false) {
    return inquirerConfirm({ message, default: defaultValue });
  },
};
