import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  Field,
  FieldDescription,
  FieldLabel,
  Input,
  Label,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Textarea,
} from "@shared/ui";

describe("shadcn UI primitives", () => {
  it("renders button and badge primitives without legacy wrapper APIs", () => {
    render(
      <div>
        <Button variant="outline">Primary action</Button>
        <Badge variant="secondary">Active</Badge>
      </div>,
    );

    expect(screen.getByRole("button", { name: "Primary action" })).toHaveAttribute(
      "data-slot",
      "button",
    );
    expect(screen.getByText("Active")).toHaveAttribute("data-slot", "badge");
  });

  it("renders card composition exports", () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Plan status</CardTitle>
          <CardDescription>Current node needs review.</CardDescription>
        </CardHeader>
        <CardContent>Blocked on approval.</CardContent>
        <CardFooter>Resume execution</CardFooter>
      </Card>,
    );

    expect(screen.getByText("Plan status")).toHaveAttribute(
      "data-slot",
      "card-title",
    );
    expect(screen.getByText("Blocked on approval.")).toHaveAttribute(
      "data-slot",
      "card-content",
    );
  });

  it("renders form primitives and field composition", () => {
    render(
      <Field>
        <FieldLabel htmlFor="task-title">Title</FieldLabel>
        <Input id="task-title" defaultValue="Write evidence" />
        <Label htmlFor="task-notes">Notes</Label>
        <Textarea id="task-notes" defaultValue="No regressions" />
        <FieldDescription>Visible state remains clear.</FieldDescription>
      </Field>,
    );

    expect(screen.getByLabelText("Title")).toHaveAttribute("data-slot", "input");
    expect(screen.getByLabelText("Notes")).toHaveAttribute("data-slot", "textarea");
    expect(screen.getByText("Visible state remains clear.")).toHaveAttribute(
      "data-slot",
      "field-description",
    );
  });

  it("renders select primitives with grouped items", () => {
    render(
      <Select defaultValue="review">
        <SelectTrigger aria-label="Node state">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="review">Review</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>,
    );

    expect(screen.getByRole("combobox", { name: "Node state" })).toHaveAttribute(
      "data-slot",
      "select-trigger",
    );
  });
});
