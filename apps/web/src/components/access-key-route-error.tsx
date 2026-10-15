import { useRouteError } from "react-router-dom";
import { ErrorLocaleProvider, ErrorScreen } from "./error-screen";

import { AccessKeyUnlock } from "@/components/access-key-unlock";
import { NotFoundPage } from "@/components/not-found-page";
import { setAccessKey } from "@shared/http";

function getErrorStatus(error: unknown) {
	if (error instanceof Response) return error.status;
	if (error && typeof error === "object" && "status" in error) {
		const status = (error as { status?: unknown }).status;
		return typeof status === "number" ? status : null;
	}
	return null;
}

export function AccessKeyRouteError() {
	const error = useRouteError();

	if (getErrorStatus(error) === 401) {
		return (
			<ErrorLocaleProvider>
				<AccessKeyUnlock
					onUnlock={(key, remember) => {
						setAccessKey(key, remember);
						window.location.reload();
					}}
				/>
			</ErrorLocaleProvider>
		);
	}

	if (getErrorStatus(error) === 404) return <ErrorLocaleProvider><NotFoundPage /></ErrorLocaleProvider>;

	return <ErrorScreen />;
}
