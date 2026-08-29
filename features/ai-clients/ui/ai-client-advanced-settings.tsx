import { Controller, type UseFormReturn } from "react-hook-form";
import {
	Checkbox,
	Field,
	FieldContent,
	FieldError,
	FieldLabel,
	Input,
	Select,
	SelectContent,
	SelectGroup,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@shared/ui";
import type {
	ClientFormValues,
	RuntimeProviderOption,
} from "./ai-client-types";
import { getFeatureCopy, getProviderFeatures, LOCAL_HERMES_BASE_URL, validateHermesRemoteBaseUrl } from "./ai-client-view-model";

export type AdvancedSettingsProps = {
	form: UseFormReturn<ClientFormValues>;
	copy: Record<string, string>;
	providers: RuntimeProviderOption[];
	type: ClientFormValues["type"];
	isLocalHermes: boolean;
};

type TextFieldProps = {
	form: UseFormReturn<ClientFormValues>;
	name:
		| "baseUrl"
		| "apiKey"
		| "provider"
		| "model"
		| "configDirectory"
		| "homeDirectory"
		| "codingAgentDirectory"
		| "timeoutSeconds";
	id: string;
	label: string;
	placeholder: string;
	password?: boolean;
	required?: string;
};

function TextField({
	form,
	name,
	id,
	label,
	placeholder,
	password,
	required,
}: TextFieldProps) {
	const error = form.formState.errors[name];
	return (
		<Field data-invalid={Boolean(error)}>
			<FieldLabel htmlFor={id}>{label}</FieldLabel>
			<Input
				{...form.register(
					name,
					required
						? { required, validate: (value) => Number(value) > 0 || required }
						: undefined,
				)}
				aria-invalid={Boolean(error)}
				id={id}
				type={
					password
						? "password"
						: name === "timeoutSeconds"
							? "number"
							: undefined
				}
				placeholder={placeholder}
			/>
			{error ? <FieldError errors={[error]} /> : null}
		</Field>
	);
}

function StandardProviderSettings({
	form,
	copy,
	type,
	isLocalHermes,
}: AdvancedSettingsProps) {
	const validateRemote = (value: string) =>
		type !== "hermes" || isLocalHermes || validateHermesRemoteBaseUrl(value, copy.remoteBaseUrlRequired);
	return (
		<>
			<Field>
				<FieldLabel htmlFor="ai-client-base-url">Base URL</FieldLabel>
				<Input
					{...form.register("baseUrl", { validate: validateRemote })}
					id="ai-client-base-url"
					placeholder={
						isLocalHermes ? LOCAL_HERMES_BASE_URL : "https://hermes-host:8642"
					}
				/>
				{form.formState.errors.baseUrl ? (
					<FieldError errors={[form.formState.errors.baseUrl]} />
				) : null}
			</Field>
			<div className="grid gap-4 md:grid-cols-2">
				<TextField
					form={form}
					name="apiKey"
					id="ai-client-api-key"
					label="API Key"
					password
					placeholder="optional for localhost"
				/>
				<TextField
					form={form}
					name="timeoutSeconds"
					id="ai-client-timeout"
					label="Timeout (seconds)"
					placeholder=""
					required={copy.timeoutSeconds}
				/>
			</div>
		</>
	);
}

function ClaudeCodeSettings({
	form,
	copy,
}: Pick<AdvancedSettingsProps, "form" | "copy">) {
	return (
		<>
			<div className="grid gap-4 md:grid-cols-2">
				<TextField
					form={form}
					name="model"
					id="ai-client-model"
					label="ANTHROPIC_MODEL"
					placeholder="optional model override"
				/>
				<TextField
					form={form}
					name="baseUrl"
					id="ai-client-base-url"
					label="ANTHROPIC_BASE_URL"
					placeholder="optional custom Anthropic-compatible base URL"
				/>
			</div>
			<TextField
				form={form}
				name="apiKey"
				id="ai-client-api-key"
				label="ANTHROPIC_AUTH_TOKEN"
				password
				placeholder="optional auth token"
			/>
			<TextField
				form={form}
				name="configDirectory"
				id="ai-client-config-directory"
				label="Config directory"
				placeholder="default user-level Claude Code config"
			/>
			<TextField
				form={form}
				name="timeoutSeconds"
				id="ai-client-timeout"
				label="Timeout (seconds)"
				placeholder=""
				required={copy.timeoutSeconds}
			/>
			<p className="text-xs text-muted-foreground">
				MCP base URL is set automatically by the engine. Pass an Anthropic API
				key for production usage to avoid the SDK subscription quota (2026-06-15
				onward).
			</p>
		</>
	);
}

function CodexSettings({
	form,
	copy,
}: Pick<AdvancedSettingsProps, "form" | "copy">) {
	return (
		<>
			<div className="grid gap-4 md:grid-cols-2">
				<TextField
					form={form}
					name="model"
					id="ai-client-model"
					label="Model"
					placeholder="optional model override"
				/>
				<TextField
					form={form}
					name="baseUrl"
					id="ai-client-base-url"
					label="OpenAI Responses Base URL"
					placeholder="optional OpenAI Responses-compatible base URL"
				/>
			</div>
			<TextField
				form={form}
				name="apiKey"
				id="ai-client-api-key"
				label="OPENAI_API_KEY"
				password
				placeholder="optional API key"
			/>
			<TextField
				form={form}
				name="configDirectory"
				id="ai-client-config-directory"
				label="CODEX_HOME"
				placeholder="default user-level Codex home (~/.codex)"
			/>
			<TextField
				form={form}
				name="timeoutSeconds"
				id="ai-client-timeout"
				label="Timeout (seconds)"
				placeholder=""
				required={copy.timeoutSeconds}
			/>
			<p className="text-xs text-muted-foreground">
				Uses the Codex provider adapter with scoped MCP control tools passed at
				runtime.
			</p>
		</>
	);
}

function OmpApiTypeField({ form }: Pick<AdvancedSettingsProps, "form">) {
	return (
		<Field>
			<FieldLabel htmlFor="ai-client-api">API type</FieldLabel>
			<Controller
				name="api"
				control={form.control}
				render={({ field }) => (
					<Select value={field.value} onValueChange={field.onChange}>
						<SelectTrigger id="ai-client-api" className="w-full" aria-label="API type">
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectGroup>
								<SelectItem value="openai-responses">openai-responses</SelectItem>
								<SelectItem value="openai-completions">openai-completions</SelectItem>
								<SelectItem value="anthropic-messages">anthropic-messages</SelectItem>
								<SelectItem value="openrouter">openrouter</SelectItem>
							</SelectGroup>
						</SelectContent>
					</Select>
				)}
			/>
		</Field>
	);
}

function OmpSettings({
	form,
	copy,
}: Pick<AdvancedSettingsProps, "form" | "copy">) {
	return (
		<>
			<div className="grid gap-4 md:grid-cols-2">
				<TextField
					form={form}
					name="provider"
					id="ai-client-provider"
					label="Provider"
					placeholder="for example nrouter"
				/>
				<TextField
					form={form}
					name="model"
					id="ai-client-model"
					label="Model"
					placeholder="for example cx/gpt-5.6-sol"
				/>
			</div>
			<div className="grid gap-4 md:grid-cols-2">
				<OmpApiTypeField form={form} />
				<TextField
					form={form}
					name="baseUrl"
					id="ai-client-base-url"
					label="OMP Base URL"
					placeholder="optional OMP provider base URL"
				/>
			</div>
			<TextField
				form={form}
				name="apiKey"
				id="ai-client-api-key"
				label="OMP API Key"
				password
				placeholder="fallback to OMP credentials if empty"
			/>
			<div className="grid gap-4 md:grid-cols-2">
				<TextField
					form={form}
					name="homeDirectory"
					id="ai-client-home-directory"
					label="HOME"
					placeholder="default process HOME"
				/>
				<TextField
					form={form}
					name="configDirectory"
					id="ai-client-config-directory"
					label="PI_CONFIG_DIR"
					placeholder="default .omp under HOME"
				/>
			</div>
			<TextField
				form={form}
				name="codingAgentDirectory"
				id="ai-client-coding-agent-directory"
				label="PI_CODING_AGENT_DIR"
				placeholder="default ~/.omp/agent"
			/>
			<TextField
				form={form}
				name="timeoutSeconds"
				id="ai-client-timeout"
				label="Timeout (seconds)"
				placeholder=""
				required={copy.timeoutSeconds}
			/>
			<p className="text-xs text-muted-foreground">
				All OMP runs use the in-process SDK with configured credentials when
				present, then fall back to local OMP credentials under ~/.omp.
			</p>
		</>
	);
}

function DebugSettings({
	form,
	copy,
}: Pick<AdvancedSettingsProps, "form" | "copy">) {
	return (
		<Field>
			<FieldLabel>{copy.debugProfileLabel}</FieldLabel>
			<Controller
				name="debugProfile"
				control={form.control}
				render={({ field, fieldState }) => (
					<Select value={field.value} onValueChange={field.onChange}>
						<SelectTrigger
							className="w-full"
							aria-invalid={fieldState.invalid}
							aria-label={copy.debugProfileLabel}
						>
							<SelectValue />
						</SelectTrigger>
						<SelectContent>
							<SelectGroup>
								<SelectItem value="deterministic">
									{copy.debugProfileDeterministic}
								</SelectItem>
								<SelectItem value="tool-submit">
									{copy.debugProfileToolSubmit}
								</SelectItem>
								<SelectItem value="hermes-like">
									{copy.debugProfileHermesLike}
								</SelectItem>
							</SelectGroup>
						</SelectContent>
					</Select>
				)}
			/>
		</Field>
	);
}

function FeatureBindings({
	form,
	providers,
	type,
}: Pick<AdvancedSettingsProps, "form" | "providers" | "type">) {
	const features = getProviderFeatures(providers, type);
	if (!features.length) return null;
	return (
		<Field>
			<FieldLabel>Feature bindings</FieldLabel>
			<div className="grid gap-3 rounded-md border p-3">
				{features.map((feature) => (
					<Controller
						key={feature}
						name="bindings"
						control={form.control}
						render={({ field }) => {
							const featureCopy = getFeatureCopy(feature);
							return (
								<Field orientation="horizontal" className="items-start gap-3">
									<Checkbox
										checked={field.value.includes(feature)}
										onCheckedChange={(checked) =>
											field.onChange(
												checked === true
													? [...new Set([...field.value, feature])]
													: field.value.filter((value) => value !== feature),
											)
										}
									/>
									<FieldContent>
										<FieldLabel>{featureCopy.label}</FieldLabel>
										<p className="text-xs text-muted-foreground">
											{featureCopy.description}
										</p>
									</FieldContent>
								</Field>
							);
						}}
					/>
				))}
			</div>
		</Field>
	);
}

export function AdvancedSettings(props: AdvancedSettingsProps) {
	const { copy, type, form, providers } = props;
	const standard =
		type !== "debug" &&
		type !== "claude_code" &&
		type !== "codex" &&
		type !== "omp";
	return (
		<details className="rounded-lg border border-border/70 bg-muted/15 p-3">
			<summary className="cursor-pointer font-medium text-foreground">
				{copy.advancedSettings}
			</summary>
			<p className="mt-1 text-xs text-muted-foreground">
				{copy.advancedSettingsHelp}
			</p>
			<div className="mt-4 grid gap-4">
				{standard ? <StandardProviderSettings {...props} /> : null}
				{type === "claude_code" ? (
					<ClaudeCodeSettings form={form} copy={copy} />
				) : null}
				{type === "codex" ? <CodexSettings form={form} copy={copy} /> : null}
				{type === "omp" ? <OmpSettings form={form} copy={copy} /> : null}
				{type === "debug" ? <DebugSettings form={form} copy={copy} /> : null}
				<FeatureBindings form={form} providers={providers} type={type} />
			</div>
		</details>
	);
}
