import { notFound } from "next/navigation";
import { PackageDocs } from "@/components/docs/packageDocs";
import { packages } from "@/lib/packages";

interface Props {
    params: { package: string };
}

export default function Page({ params }: Props) {
    if (!packages.includes(params.package)) {
        return notFound();
    }

    return <PackageDocs package={params.package} />;
}

export async function generateMetadata({ params }: Props) {
    const packageName = params.package;
    return {
        title: `${packageName} - jazz`,
        description: `API reference for ${packageName}.`,
    };
}

export async function generateStaticParams() {
    // TODO: ideally we check which files exist in ../../typedoc
    return [
        "jazz-tools",
        "jazz-react",
        "jazz-nodejs",
        "jazz-browser",
        "jazz-browser-media-images",
    ].map((pkg) => ({ package: pkg }));
}