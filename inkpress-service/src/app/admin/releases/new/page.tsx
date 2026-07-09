import { requireAdmin } from "@/lib/auth/admin-guard";
import { VersionCreateForm } from "@/components/releases/version-create-form";

export default async function NewReleasePage() {
  await requireAdmin();
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold">新建版本</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          手动创建版本骨架。创建后可在详情页上传架构包。
        </p>
      </div>
      <VersionCreateForm />
    </div>
  );
}
